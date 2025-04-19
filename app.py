# app.py
import threading
import time
import json
import sys # To check import errors
from flask import Flask, jsonify, request
from flask_cors import CORS # To allow requests from your UI development server

# --- Import necessary components from your bot script ---
# Assuming pump_bot.py is in the same directory
try:
    from pump_bot import (
        monitor_and_sell,
        monitored_tokens, # The shared state dictionary
        load_state,
        save_state,
        SELL_DELAY_SECONDS,
        TAKE_PROFIT_SOL,
        SLIPPAGE_PERCENT,
        CHECK_INTERVAL_SECONDS,
        STATE_FILE # Import state file name if needed for direct access
    )
    print("Successfully imported from pump_bot.")
except ImportError as e:
    print(f"FATAL: Error importing from pump_bot: {e}")
    print("Make sure pump_bot.py is in the same directory and has no syntax errors.")
    sys.exit(1) # Exit if import fails
except Exception as e:
    print(f"FATAL: An unexpected error occurred during import: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# --- Flask App Setup ---
app = Flask(__name__)
# Allow requests from your typical frontend development origin
CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}})

# --- State Management and Locking ---
# A lock to safely access monitored_tokens from multiple threads
state_lock = threading.Lock()
bot_thread = None
bot_running = False

# --- Background Bot Task ---
def run_bot_loop():
    """ Function to run the bot's main monitoring loop. """
    global bot_running
    print("[BOT] Starting bot loop in background thread...")
    bot_running = True
    try:
        # Pass the lock to the main bot function
        print("[BOT] Calling monitor_and_sell...")
        monitor_and_sell(state_lock)
    except Exception as e:
        print(f"[ERROR] Bot loop encountered a fatal error: {e}")
        import traceback
        traceback.print_exc()
        # Optionally, implement logic here to attempt a restart or notify
    finally:
        print("[BOT] Bot loop thread has finished or crashed.")
        bot_running = False
        # Attempt a final save, acquiring the lock
        print("[BOT] Attempting final state save...")
        try:
            # We need the save_state function that accepts the lock
            save_state(state_lock)
            print("[BOT] Final state save attempt complete.")
        except Exception as save_err:
            print(f"[ERROR] during final state save: {save_err}")



# --- API Endpoints ---

@app.route('/api/status', methods=['GET'])
def get_status():
    """Returns the current status of monitored tokens and bot running state."""
    print("[API] GET /api/status called")
    global monitored_tokens # Ensure we're accessing the global dict
    tokens_snapshot = {}
    is_running = bot_running # Get current running state

    try:
        with state_lock: # Acquire lock before reading shared state
            # Create a deep copy for safety, especially with nested data potentially
            # Using json loads/dumps is a common way for complex objects
            tokens_snapshot = json.loads(json.dumps(monitored_tokens, default=str))

        response_data = {
            "bot_running": is_running,
            "tokens": tokens_snapshot
        }
        print(f"[API] /api/status response: bot_running={is_running}, tokens_count={len(tokens_snapshot)}")
        return jsonify(response_data)
    except Exception as e:
         print(f"[ERROR] in /api/status: {e}")
         import traceback
         traceback.print_exc()
         # Return cached data or error message
         return jsonify({"error": "Failed to get status", "bot_running": is_running, "tokens": {}}), 500


@app.route('/api/config', methods=['GET'])
def get_config():
    """Returns the current bot configuration."""
    print("[API] GET /api/config called")
    try:
        # Read config directly from the imported variables
        config_data = {
            "sell_delay_seconds": SELL_DELAY_SECONDS,
            "take_profit_sol": str(TAKE_PROFIT_SOL), # Convert Decimal
            "slippage_percent": str(SLIPPAGE_PERCENT), # Convert Decimal
            "check_interval_seconds": CHECK_INTERVAL_SECONDS,
            "state_file": STATE_FILE
        }
        print(f"[API] /api/config response: {config_data}")
        return jsonify(config_data)
    except Exception as e:
        print(f"[ERROR] in /api/config: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to get config"}), 500


# --- Main Execution ---
if __name__ == '__main__':
    print("Initializing Flask app...")

    # Start the bot loop in a background thread
    # Check if thread is already running perhaps? (simple check for now)
    if bot_thread is None or not bot_thread.is_alive():
        print("Starting bot thread...")
        bot_thread = threading.Thread(target=run_bot_loop, daemon=True) # daemon=True allows main thread to exit even if bot hangs
        bot_thread.start()
    else:
        print("Bot thread already running.")


    # Give the bot thread a moment to initialize (optional, adjust if needed)
    time.sleep(2)
    if not bot_running:
         print("Warning: Bot thread may not have started correctly.")


    print("Starting Flask server on http://127.0.0.1:5001 ...")
    # Use port 5001 to avoid conflicts
    # Set debug=False for stability when using threads/background tasks
    # Set use_reloader=False explicitly can also help prevent issues with threads running twice
    app.run(host='127.0.0.1', port=5001, debug=False, use_reloader=False)
