# -*- coding: utf-8 -*-
# --- Corrected imports ---
import os
import time
import base58
import re
import json
from decimal import Decimal
import threading # <<< Added for Lock type hint and usage

from dotenv import load_dotenv
from borsh_construct import CStruct, U64, Bool, Bytes, Vec, U8

# --- Solana/Solders Core Imports ---
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.system_program import ID as SYS_PROGRAM_ID
from solders.token import ID as TOKEN_PROGRAM_ID
from solders.compute_budget import set_compute_unit_limit, set_compute_unit_price
from solders.sysvar import RENT as RENT_PROGRAM_ID
from solders.transaction import Transaction, TransactionError
from solders.instruction import Instruction as TransactionInstruction
from solders.instruction import AccountMeta

# Associated Token Account
from solders.associated_token_account import ID as ASSOCIATED_TOKEN_PROGRAM_ID, get_associated_token_address

# Solana Client and RPC Types
from solana.rpc.api import Client
from solana.rpc.commitment import Confirmed, Processed
from solana.rpc.types import TokenAccountOpts, TxOpts, Memcmp, DataSliceOpts
from solana.exceptions import SolanaRpcException
# --- End Corrected Imports ---

# --- Configuration ---
load_dotenv()
RPC_URL = os.getenv("RPC_URL")
DEV_PRIVATE_KEY_B58 = os.getenv("DEV_PRIVATE_KEY")

# --- Constants ---
# (Keep your constants as they were)
PUMP_FUN_PROGRAM_ID = Pubkey.from_string("6EF8rrecthR5DkVzkKnJudaNZpkpKHeZQR88MpGkCGyA")
PUMP_FUN_ACCOUNT = Pubkey.from_string("32dGqHQQxVPdUJK6m1x5NUKM4wxa3b3tfpsufn4BG3qk")
GLOBAL_ACCOUNT = Pubkey.from_string("4wTV1YmiEkRvAtNtsSGPtUrqRYQgFpxwGJaAhrfeJWyd")
FEE_RECIPIENT = Pubkey.from_string("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4f57gj")
MINT_AUTHORITY = Pubkey.from_string("TSLvdd1pWpaJaHhSV43gHX6JuXdDgTdfKGiHrAFfNBG")
CREATE_IX_DISCRIMINATOR_B58 = "3Bf4qLf4hW"
CREATE_IX_DISCRIMINATOR_BYTES = base58.b58decode(CREATE_IX_DISCRIMINATOR_B58)
SELL_INSTRUCTION_DISCRIMINATOR = bytes([0x75, 0x1a, 0x89, 0xe0, 0x3c, 0x13, 0xd2, 0x31])

# --- Bot Settings ---
# (Read from .env, provide defaults)
SELL_DELAY_SECONDS = int(os.getenv("SELL_DELAY_SECONDS", 15))
TAKE_PROFIT_SOL = Decimal(os.getenv("TAKE_PROFIT_SOL", "0.05"))
CHECK_INTERVAL_SECONDS = int(os.getenv("CHECK_INTERVAL_SECONDS", 2))
MAX_SELL_RETRIES = int(os.getenv("MAX_SELL_RETRIES", 5))
RETRY_DELAY_SECONDS = int(os.getenv("RETRY_DELAY_SECONDS", 2))
SLIPPAGE_PERCENT = Decimal(os.getenv("SLIPPAGE_PERCENT", "25.0"))
TRANSACTION_PRIORITY_MICRO_LAMPORTS = int(os.getenv("TRANSACTION_PRIORITY_MICRO_LAMPORTS", 50000))
TRANSACTION_COMPUTE_UNITS = int(os.getenv("TRANSACTION_COMPUTE_UNITS", 200000))
STATE_FILE = os.getenv("STATE_FILE", "bot_state.json")

# --- Global State (Accessed by multiple threads via Flask app) ---
monitored_tokens = {} # This dictionary is shared

# --- Solana Client & Wallet ---
# Defined globally for access by helper functions
solana_client = None
DEV_WALLET = None
DEV_PUBLIC_KEY = None
try:
    if not RPC_URL: raise ValueError("RPC_URL not found in .env")
    solana_client = Client(RPC_URL, commitment=Confirmed, timeout=30.0)
    if not DEV_PRIVATE_KEY_B58: raise ValueError("DEV_PRIVATE_KEY not found in .env")
    DEV_WALLET = Keypair.from_base58_string(DEV_PRIVATE_KEY_B58)
    DEV_PUBLIC_KEY = DEV_WALLET.pubkey()
    print("Solana client and wallet initialized successfully.")
except Exception as e:
    print(f"FATAL: Error initializing Solana client or wallet: {e}")
    # If this fails, the bot cannot run. We raise to prevent app start.
    raise SystemExit(f"Failed to initialize Solana connection: {e}")


# --- Borsh Schemas ---
BONDING_CURVE_LAYOUT = CStruct(
    "virtual_token_reserves" / U64, "virtual_sol_reserves" / U64,
    "real_token_reserves" / U64, "real_sol_reserves" / U64,
    "token_total_supply" / U64, "complete" / Bool,
)
SELL_INSTRUCTION_PAYLOAD = CStruct("token_amount" / U64, "min_sol_output" / U64)


# --- Helper Functions (Modified for Thread Safety) ---

def save_state(lock: threading.Lock): # <<< Accept lock
    """Saves the monitored_tokens state to a JSON file safely."""
    global monitored_tokens
    state_to_save = {}
    # Acquire lock to get a consistent copy of the state
    with lock:
        # Using json dumps/loads ensures serializability and creates a deep copy
        try:
            state_to_save = json.loads(json.dumps(monitored_tokens, default=str))
        except Exception as json_err:
             print(f"Error serializing state for saving: {json_err}")
             return # Don't proceed if serialization fails

    # Perform file I/O outside the lock to minimize lock hold time
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(state_to_save, f, indent=4)
        # print(f"State saved ({len(state_to_save)} tokens)") # Reduce log noise
    except Exception as e:
        print(f"Error saving state to file {STATE_FILE}: {e}")

def load_state(lock: threading.Lock): # <<< Accept lock
    """Loads the monitored_tokens state from a JSON file safely."""
    global monitored_tokens
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                loaded_data = json.load(f)
            # Validate loaded data structure if needed before assigning
            if isinstance(loaded_data, dict):
                 with lock: # <<< Acquire lock to update shared state
                     monitored_tokens = loaded_data
                 print(f"Loaded {len(loaded_data)} tokens from {STATE_FILE}")
            else:
                 print(f"Warning: Invalid data format in {STATE_FILE}. Starting fresh.")
                 with lock: monitored_tokens = {}

        except json.JSONDecodeError:
            print(f"Error decoding JSON from {STATE_FILE}. Starting fresh.")
            with lock: monitored_tokens = {}
        except Exception as e:
            print(f"Error loading state from {STATE_FILE}: {e}")
            with lock: monitored_tokens = {}
    else:
        print(f"State file {STATE_FILE} not found. Starting fresh.")
        with lock: monitored_tokens = {} # Ensure it's initialized if file missing


# --- Other Helper Functions (No direct modification of monitored_tokens needed) ---
# These functions read data or perform actions but don't change the shared dict.

def get_sol_balance(pubkey: Pubkey) -> Decimal:
    """Gets SOL balance for a public key."""
    if not solana_client: return Decimal("-1") # Check if client initialized
    try:
        balance_resp = solana_client.get_balance(pubkey, commitment=Processed)
        return Decimal(balance_resp.value) / Decimal(1e9)
    except SolanaRpcException as e:
        print(f"Warning: Could not get SOL balance for {pubkey}: {e}")
        return Decimal("-1")
    except Exception as e:
        print(f"Unexpected error getting SOL balance for {pubkey}: {e}")
        return Decimal("-1")

def get_token_balance(token_account_pk: Pubkey) -> int:
    """Gets the token balance (raw amount/lamports) of a specific token account."""
    if not solana_client: return -1 # Check if client initialized
    try:
        resp = solana_client.get_token_account_balance(token_account_pk, commitment=Processed)
        if resp.value and isinstance(resp.value.amount, str) and resp.value.amount.isdigit():
                 return int(resp.value.amount)
        return 0
    except SolanaRpcException as e:
        if "Account does not exist" in str(e) or "AccountNotFound" in str(e) or "could not find account" in str(e):
            return 0
        print(f"Warning: RPC Error getting token balance for {token_account_pk}: {e}")
        return -1
    except Exception as e:
        print(f"Unexpected error getting token balance for {token_account_pk}: {e}")
        return -1

def derive_bonding_curve_pda(mint_pk: Pubkey) -> Pubkey:
    """Derives the bonding curve PDA for a given mint."""
    seeds = [b"bonding-curve", bytes(mint_pk)]
    pda, _ = Pubkey.find_program_address(seeds, PUMP_FUN_PROGRAM_ID)
    return pda

def get_bonding_curve_state(bonding_curve_pk: Pubkey):
    """ Fetches and parses the account data for a Pump.fun bonding curve. """
    if not solana_client: return None # Check if client initialized
    try:
        data_slice = DataSliceOpts(offset=0, length=64) # Fetch enough for layout + discriminator
        acc_info_resp = solana_client.get_account_info(
            bonding_curve_pk, commitment=Processed, encoding="base64", data_slice=data_slice
        )
        # Check response structure carefully
        if not acc_info_resp or not acc_info_resp.value or not acc_info_resp.value.data:
            return None

        data = acc_info_resp.value.data
        # Check data length against expected size
        if len(data) < (8 + BONDING_CURVE_LAYOUT.sizeof()):
            # print(f"Warning: Bonding curve data too short for {bonding_curve_pk}. Length: {len(data)}")
            return None

        parsed_data = BONDING_CURVE_LAYOUT.parse(data[8:]) # Skip 8-byte discriminator

        price_sol_per_token = Decimal(0)
        # Use Decimal for calculations involving reserves
        virtual_sol_reserves_dec = Decimal(parsed_data.virtual_sol_reserves)
        virtual_token_reserves_dec = Decimal(parsed_data.virtual_token_reserves)

        if virtual_token_reserves_dec > 0:
            price_lamports_per_lamport = virtual_sol_reserves_dec / virtual_token_reserves_dec
            price_sol_per_token = price_lamports_per_lamport * (Decimal(10**6) / Decimal(10**9)) # Assume 6 token decimals

        return {
            "virtual_token_reserves": parsed_data.virtual_token_reserves,
            "virtual_sol_reserves": parsed_data.virtual_sol_reserves,
            "real_token_reserves": parsed_data.real_token_reserves,
            "real_sol_reserves": parsed_data.real_sol_reserves,
            "token_total_supply": parsed_data.token_total_supply,
            "is_complete": parsed_data.complete,
            "price_sol_per_token": price_sol_per_token # Return as Decimal
        }
    except SolanaRpcException as e:
        # Reduce noise for common errors like account not found yet
        if "AccountNotFound" not in str(e) and "could not find account" not in str(e):
            print(f"Warning: RPC Error fetching bonding curve {bonding_curve_pk} state: {e}")
        return None
    except Exception as e:
        print(f"Warning: Error parsing bonding curve {bonding_curve_pk} data: {e}")
        return None

def find_dev_created_pump_fun_mints(transactions):
    """ Parses transactions to find Pump.fun creations by DEV_WALLET using 'create' ix discriminator. """
    if not solana_client: return [] # Check if client initialized
    new_mints = []
    # (Keep the implementation from the last correct version)
    try:
        for sig in transactions:
            tx_resp = solana_client.get_transaction(
                sig, encoding="base64", max_supported_transaction_version=0, commitment=Confirmed
            )
            if not tx_resp or not tx_resp.value or not tx_resp.value.transaction: continue

            tx_raw = tx_resp.value.transaction.transaction
            message = tx_raw.message
            # Ensure account_keys is not empty before accessing index 0
            if not message.account_keys or message.account_keys[0] != DEV_PUBLIC_KEY: continue # Check fee payer

            for ix_raw in message.instructions:
                # Prevent index out of bounds if program_id_index is invalid
                if ix_raw.program_id_index >= len(message.account_keys): continue
                program_id = message.account_keys[ix_raw.program_id_index]

                if program_id == PUMP_FUN_PROGRAM_ID:
                    try:
                        ix_data = base58.b58decode(ix_raw.data)
                    except Exception: # Handle potential decoding errors
                        continue

                    if ix_data.startswith(CREATE_IX_DISCRIMINATOR_BYTES):
                        # Mint is account index 2 in the 'create' instruction's list
                        if len(ix_raw.accounts) > 2:
                            # Prevent index out of bounds for accounts list
                            mint_account_index_in_ix = 2
                            if mint_account_index_in_ix >= len(ix_raw.accounts): continue
                            mint_account_index_in_tx = ix_raw.accounts[mint_account_index_in_ix]
                            # Prevent index out of bounds for message keys
                            if mint_account_index_in_tx >= len(message.account_keys): continue

                            potential_mint_pk = message.account_keys[mint_account_index_in_tx]
                            # Simple check: Does it look like a Pubkey? (basic validation)
                            if len(str(potential_mint_pk)) > 30:
                                # print(f"  +++ Possible Pump.fun creation by DEV detected. Mint: {potential_mint_pk} in Tx: {sig}")
                                # Check needed here if it's already monitored is done in the main loop
                                new_mints.append(str(potential_mint_pk))
                        break # Found create ix in this tx
    except SolanaRpcException as e:
        print(f"Warning: RPC Error parsing transactions: {e}")
    except Exception as e:
        print(f"Warning: Unexpected error parsing transactions: {e}")
        import traceback; traceback.print_exc()
    # Return unique mints found
    return list(set(new_mints))


def execute_sell(mint_pk_str: str, bonding_curve_pk_str: str, dev_ata_pk_str: str, amount_lamports: int, min_sol_output_lamports: int):
    """ Builds, signs, and sends a Pump.fun sell transaction. Does NOT modify shared state. """
    if not solana_client or not DEV_WALLET: return False, None # Check prerequisites
    start_time = time.time()
    # (Keep the implementation from the last correct version)
    print(f"Attempting to sell {amount_lamports / 1e6:.6f} tokens [{mint_pk_str[:6]}...]...")
    print(f"  Min SOL output: {Decimal(min_sol_output_lamports) / Decimal(1e9):.9f} SOL")

    try:
        mint_pk = Pubkey.from_string(mint_pk_str)
        bonding_curve_pk = Pubkey.from_string(bonding_curve_pk_str)
        dev_ata_pk = Pubkey.from_string(dev_ata_pk_str)
        bonding_curve_ata_pk = get_associated_token_address(bonding_curve_pk, mint_pk)
    except ValueError as e:
        print(f"  Error creating Pubkey from string: {e}"); return False, None

    try:
        payload = SELL_INSTRUCTION_PAYLOAD.build({
            "token_amount": amount_lamports, "min_sol_output": min_sol_output_lamports
        })
        instruction_data = SELL_INSTRUCTION_DISCRIMINATOR + payload

        accounts = [
            AccountMeta(GLOBAL_ACCOUNT, False, False),           # 0. Global
            AccountMeta(FEE_RECIPIENT, False, True),             # 1. Fee Recipient (W)
            AccountMeta(mint_pk, False, False),                  # 2. Mint
            AccountMeta(bonding_curve_pk, False, True),          # 3. Bonding Curve (W)
            AccountMeta(bonding_curve_ata_pk, False, True),      # 4. Bonding Curve ATA (W)
            AccountMeta(dev_ata_pk, False, True),                # 5. Seller ATA (W)
            AccountMeta(DEV_PUBLIC_KEY, True, True),             # 6. Seller (WS)
            AccountMeta(SYS_PROGRAM_ID, False, False),           # 7. System Program
            AccountMeta(ASSOCIATED_TOKEN_PROGRAM_ID, False, False),# 8. ATA Program
            AccountMeta(TOKEN_PROGRAM_ID, False, False),         # 9. Token Program
            AccountMeta(PUMP_FUN_ACCOUNT, False, False),         # 10. Pump Fun Account
            AccountMeta(RENT_PROGRAM_ID, False, False),          # 11. Rent Sysvar
        ]

        sell_instruction = TransactionInstruction(PUMP_FUN_PROGRAM_ID, instruction_data, accounts)

        try:
            blockhash_resp = solana_client.get_latest_blockhash(commitment=Confirmed)
            recent_blockhash = blockhash_resp.value.blockhash
            last_valid_block_height = blockhash_resp.value.last_valid_block_height
        except SolanaRpcException as e:
             print(f"  Error fetching blockhash: {e}. Cannot proceed with sell."); return False, None
        except AttributeError: # Handle cases where blockhash_resp.value might be None
             print("  Error fetching blockhash: Received invalid response."); return False, None


        transaction = Transaction(recent_blockhash=recent_blockhash, fee_payer=DEV_PUBLIC_KEY)
        if TRANSACTION_PRIORITY_MICRO_LAMPORTS > 0: transaction.add(set_compute_unit_price(TRANSACTION_PRIORITY_MICRO_LAMPORTS))
        if TRANSACTION_COMPUTE_UNITS > 0: transaction.add(set_compute_unit_limit(TRANSACTION_COMPUTE_UNITS))
        transaction.add(sell_instruction)
        transaction.sign(DEV_WALLET)

        print(f"  Sending sell transaction...")
        opts = TxOpts(skip_preflight=True, preflight_commitment=Confirmed)
        try:
            send_resp = solana_client.send_transaction(transaction, DEV_WALLET, opts=opts)
            signature = send_resp.value
            print(f"    Transaction sent: https://solscan.io/tx/{signature}")
            print(f"    Time to send: {time.time() - start_time:.2f}s")

            print(f"    Confirming transaction (~60s)...")
            confirm_start_time = time.time()
            confirmation_resp = solana_client.confirm_transaction(
                signature, commitment=Confirmed, sleep_seconds=0.75, last_valid_block_height=last_valid_block_height + 150
            )
            print(f"    Confirmation check duration: {time.time() - confirm_start_time:.2f}s")

            # Check confirmation response structure carefully
            if not confirmation_resp or not confirmation_resp.value:
                 print(f"    Tx {signature} confirmation check failed (no response value). Assuming failure."); return False, str(signature)

            # Access the error status correctly (it's usually in the first element of the value tuple/list)
            tx_result_info = confirmation_resp.value[0]
            if tx_result_info is None:
                 print(f"    Tx {signature} not found or timed out during confirmation. Assuming failure."); return False, str(signature)
            elif tx_result_info.err:
                 print(f"    Tx {signature} failed confirmation: {tx_result_info.err}"); return False, str(signature)
            else:
                 print(f"    +++ Tx CONFIRMED: {signature}"); print(f"    Total sell time: {time.time() - start_time:.2f}s"); return True, str(signature)

        except SolanaRpcException as e: print(f"  RPC Error during send/confirm: {e}"); return False, None # Signature might be in e but often not reliably
        except Exception as e: print(f"  Error sending/confirming sell: {e}"); import traceback; traceback.print_exc(); return False, None
    except Exception as e: print(f"Error building/signing sell: {e}"); import traceback; traceback.print_exc(); return False, None



# --- Main Bot Logic (Modified for Thread Safety) ---
def monitor_and_sell(lock: threading.Lock): # <<< Accept lock
    """ Main loop to monitor wallet, check tokens, and trigger sells. Uses lock for state access."""
    global monitored_tokens # Ensure we intend to modify the global

    # Ensure client/wallet are initialized before starting loop
    if not solana_client or not DEV_WALLET:
         print("FATAL: Solana client or Dev Wallet not initialized. Cannot start monitor loop.")
         return # Stop the thread

    print("--- Starting Pump.fun Auto-Sell Bot Thread ---")
    print(f"Wallet: {DEV_PUBLIC_KEY}")
    print(f"Sell After: {SELL_DELAY_SECONDS}s OR Value >= {TAKE_PROFIT_SOL} SOL | Slippage: {SLIPPAGE_PERCENT}%")
    print(f"Priority: {TRANSACTION_PRIORITY_MICRO_LAMPORTS} μL/CU | Limit: {TRANSACTION_COMPUTE_UNITS} CU")
    print("-" * 30)

    try:
        # Initial load using the provided lock
        load_state(lock)
    except Exception as e:
        print(f"Error during initial state load: {e}. Starting with empty state.")
        with lock: monitored_tokens = {} # Ensure it's initialized after error

    last_tx_check_sig = None # Track the last signature checked

    # --- Main Loop ---
    while True: # This loop runs indefinitely in the background thread
        try: # Add a try/except block around the entire cycle for resilience
            cycle_start_time = time.time()
            # Use print with flush=True if output seems delayed in thread context
            print(f"\n--- Bot Cycle Start ({time.strftime('%H:%M:%S')}) ---", flush=True)

            # 1. Check for new creations
            try:
                signatures_resp = solana_client.get_signatures_for_address(
                    DEV_PUBLIC_KEY, limit=20, before=last_tx_check_sig, commitment=Confirmed
                )
                recent_signatures = [s.signature for s in signatures_resp.value] if signatures_resp.value else []

                if recent_signatures:
                    print(f"  Found {len(recent_signatures)} new signatures to check...")
                    new_mints = find_dev_created_pump_fun_mints(recent_signatures)
                    newly_added_count = 0
                    # Lock acquisition moved inside the loop for granularity
                    with lock: # <<< Lock before checking/adding to monitored_tokens
                        for mint_str in new_mints:
                             if mint_str not in monitored_tokens:
                                 try:
                                     mint_pk = Pubkey.from_string(mint_str)
                                     bonding_curve_pk = derive_bonding_curve_pda(mint_pk)
                                     dev_ata_pk = get_associated_token_address(DEV_PUBLIC_KEY, mint_pk)
                                     if mint_pk and bonding_curve_pk and dev_ata_pk:
                                          print(f"  +++ New DEV token detected! Adding: {mint_str[:6]}... +++")
                                          monitored_tokens[mint_str] = {
                                             "bonding_curve": str(bonding_curve_pk), "created_at": time.time(), "status": "monitoring",
                                             "dev_ata": str(dev_ata_pk), "sell_attempts": 0, "decimals": 6, # Assume 6
                                             "sell_tx": None, "last_value_sol": "0.0", "last_check_time": time.time()
                                          }
                                          newly_added_count += 1
                                     else:
                                          print(f"    Skipping invalid keys for mint {mint_str}")
                                 except Exception as add_err:
                                     print(f"    Error processing new mint {mint_str}: {add_err}")
                    if newly_added_count > 0:
                        save_state(lock)
                    last_tx_check_sig = recent_signatures[0]
            except SolanaRpcException as e:
                print(f"Warning: RPC Error fetching txs: {e}")
            except Exception as e:
                print(f"Warning: Error checking creations: {e}"); import traceback; traceback.print_exc();

            # 2. Check sell conditions for monitored tokens
            mints_to_process = []
            with lock:
                mints_to_process = list(monitored_tokens.keys())

            if not mints_to_process:
                 print("  No tokens currently being monitored.", flush=True)

            monitoring_count = 0
            active_tokens_summary = []

            for mint_str in mints_to_process:
                token_data_copy = None
                should_save = False

                try:
                    with lock:
                        if mint_str not in monitored_tokens: continue
                        token_data_copy = monitored_tokens[mint_str].copy()
                        monitored_tokens[mint_str]["last_check_time"] = time.time()
                    status = token_data_copy["status"]
                    if status not in ["monitoring", "sell_failed"]: continue
                    try:
                        bonding_curve_pk = Pubkey.from_string(token_data_copy["bonding_curve"])
                        dev_ata_pk = Pubkey.from_string(token_data_copy["dev_ata"])
                        decimals = token_data_copy.get("decimals", 6)
                    except ValueError as e:
                         print(f"  Error with Pubkey for {mint_str[:6]}: {e}. Skipping.")
                         continue
                    curve_state = get_bonding_curve_state(bonding_curve_pk)
                    if not curve_state:
                         continue
                    if curve_state.get("is_complete", False):
                         print(f"    Token {mint_str[:6]}... curve complete. Marking MISSED_RAYDIUM.")
                         with lock:
                             if monitored_tokens.get(mint_str, {}).get("status") in ["monitoring", "sell_failed"]:
                                  monitored_tokens[mint_str]["status"] = "missed_raydium"
                                  should_save = True
                         continue
                    dev_balance_lamports = get_token_balance(dev_ata_pk)
                    if dev_balance_lamports <= 0:
                        if status in ["monitoring", "sell_failed"] and dev_balance_lamports == 0:
                             print(f"    Dev balance for {mint_str[:6]}... is 0. Marking EMPTIED.")
                             with lock:
                                 if monitored_tokens.get(mint_str, {}).get("status") in ["monitoring", "sell_failed"]:
                                     monitored_tokens[mint_str]["status"] = "emptied"
                                     should_save = True
                        continue
                    dev_balance_float = Decimal(dev_balance_lamports) / Decimal(10**decimals)
                    price_dec = curve_state.get("price_sol_per_token", Decimal(0))
                    if not isinstance(price_dec, Decimal): price_dec = Decimal(0)
                    current_value_sol = dev_balance_float * price_dec
                    with lock:
                         if mint_str in monitored_tokens:
                              monitored_tokens[mint_str]["last_value_sol"] = str(current_value_sol)
                    if status == "monitoring":
                         monitoring_count += 1
                         active_tokens_summary.append(f"{mint_str[:6]}({dev_balance_float:.2f}|{current_value_sol:.4f}S)")
                    sell_signal = False
                    trigger_reason = ""
                    time_elapsed = time.time() - token_data_copy["created_at"]
                    if time_elapsed >= SELL_DELAY_SECONDS: sell_signal = True; trigger_reason = f"Time({time_elapsed:.0f}s)"
                    if current_value_sol >= TAKE_PROFIT_SOL:
                        if not sell_signal: trigger_reason = f"Profit(>{TAKE_PROFIT_SOL:.4f}S)"
                        sell_signal = True
                    if sell_signal:
                        print(f"\n    >>> SELL SIGNAL for {mint_str[:6]}.. ({trigger_reason}) <<<", flush=True)
                        print(f"        Value: {current_value_sol:.6f} SOL | Balance: {dev_balance_float:.{decimals}f} | Age: {time_elapsed:.0f}s")
                        if token_data_copy["sell_attempts"] >= MAX_SELL_RETRIES:
                            with lock:
                                 if monitored_tokens.get(mint_str, {}).get("status") != "failed_max_retries":
                                      monitored_tokens[mint_str]["status"] = "failed_max_retries"
                                      should_save = True
                            continue
                        expected_sol_output = current_value_sol
                        min_sol_output = expected_sol_output * (Decimal(100) - SLIPPAGE_PERCENT) / Decimal(100)
                        min_sol_output = max(Decimal(0), min_sol_output)
                        min_sol_output_lamports = int(min_sol_output * Decimal(1e9))
                        if min_sol_output_lamports <= 0:
                            print(f"    Min SOL output <= 0. Skipping sell attempt for {mint_str[:6]}..")
                            if status == "sell_failed":
                                with lock:
                                     if monitored_tokens.get(mint_str, {}).get("status") == "sell_failed":
                                          monitored_tokens[mint_str]["status"] = "monitoring"
                                          monitored_tokens[mint_str]["sell_attempts"] = 0
                                          should_save = True
                            continue
                        current_attempt = 0
                        with lock:
                            if mint_str in monitored_tokens:
                                monitored_tokens[mint_str]["sell_attempts"] += 1
                                current_attempt = monitored_tokens[mint_str]["sell_attempts"]
                                should_save = True
                            else: continue
                        print(f"    Attempting sell (Attempt #{current_attempt}/{MAX_SELL_RETRIES})...", flush=True)
                        if should_save: save_state(lock)
                        should_save = False
                        success, signature = execute_sell(
                            mint_str, token_data_copy["bonding_curve"], token_data_copy["dev_ata"],
                            dev_balance_lamports, min_sol_output_lamports
                        )
                        with lock:
                            if mint_str not in monitored_tokens: continue
                            if success:
                                monitored_tokens[mint_str]["status"] = "sold"
                                monitored_tokens[mint_str]["sell_tx"] = signature if signature else "success_no_sig"
                                should_save = True
                                print(f"    +++ SELL SUCCESSFUL for {mint_str[:6]}!")
                            else:
                                monitored_tokens[mint_str]["status"] = "sell_failed"
                                monitored_tokens[mint_str]["sell_tx"] = f"failed_{signature}" if signature else "failed_no_sig"
                                should_save = True
                                print(f"    --- SELL FAILED for {mint_str[:6]}.")
                                if monitored_tokens[mint_str]["sell_attempts"] >= MAX_SELL_RETRIES:
                                    print(f"    Max sell retries reached after this failed attempt. Marking FAILED_MAX_RETRIES.")
                                    monitored_tokens[mint_str]["status"] = "failed_max_retries"
                                else:
                                     print(f"    Waiting {RETRY_DELAY_SECONDS}s before next cycle might retry.")
                                     time.sleep(RETRY_DELAY_SECONDS)
                    elif status == "sell_failed":
                         print(f"    Sell signal reset for {mint_str[:6]}... Reverting to monitoring.")
                         with lock:
                             if monitored_tokens.get(mint_str, {}).get("status") == "sell_failed":
                                  monitored_tokens[mint_str]["status"] = "monitoring"
                                  monitored_tokens[mint_str]["sell_attempts"] = 0
                                  should_save = True
                    if should_save:
                        save_state(lock)
                except Exception as inner_e:
                    print(f"!! Error processing token {mint_str[:6]}...: {inner_e}")
                    import traceback
                    traceback.print_exc()
            if monitoring_count > 0:
                summary_str = " | ".join(active_tokens_summary)
                print(f"  Monitoring {monitoring_count} tokens: [ {summary_str} ]", flush=True)
            cycle_duration = time.time() - cycle_start_time
            wait_time = max(0, CHECK_INTERVAL_SECONDS - cycle_duration)
            print(f"--- Bot Cycle End (Took {cycle_duration:.2f}s) --- Wait {wait_time:.2f}s ---", flush=True)
            if wait_time > 0:
                time.sleep(wait_time)
        except KeyboardInterrupt:
             print("Keyboard interrupt received in bot thread. Exiting loop.")
             break
        except Exception as cycle_e:
             print(f"!!! UNEXPECTED ERROR IN BOT CYCLE: {cycle_e}")
             import traceback
             traceback.print_exc()
             print("Waiting for a longer interval before retrying cycle...")
             time.sleep(CHECK_INTERVAL_SECONDS * 5)
    print("Monitor loop finished.")
    save_state(lock)
# --- Remove the original entry point ---
# (The `if __name__ == "__main__":` block is not needed here as app.py runs it)
