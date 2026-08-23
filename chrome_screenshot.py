import json
import requests
import base64
import time

# Get the list of pages
response = requests.get('http://localhost:9222/json')
pages = response.json()

# Find the page with the Field Capture app
target_page = None
for page in pages:
    if '127.0.0.1:4177' in page.get('url', ''):
        target_page = page
        break

if not target_page:
    print("Field Capture page not found")
    print("Available pages:")
    for page in pages:
        print(f"  - {page.get('url', 'unknown')}")
    exit(1)

# Get the WebSocket URL
ws_url = target_page['webSocketDebuggerUrl']
print(f"Found page: {target_page['url']}")

# Use the DevTools endpoint to capture screenshot
import websocket
import threading

screenshot_data = None
done = threading.Event()

def on_message(ws, message):
    global screenshot_data
    msg = json.loads(message)
    if msg.get('id') == 2:
        screenshot_data = msg.get('result', {}).get('data')
        done.set()

def on_error(ws, error):
    print(f"WebSocket error: {error}")
    done.set()

def on_close(ws, close_status_code, close_msg):
    done.set()

def on_open(ws):
    # Navigate to the page
    ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": "http://127.0.0.1:4177/index.html"}}))
    time.sleep(2)
    # Capture screenshot
    ws.send(json.dumps({"id": 2, "method": "Page.captureScreenshot", "params": {}}))

ws = websocket.WebSocketApp(ws_url,
                           on_open=on_open,
                           on_message=on_message,
                           on_error=on_error,
                           on_close=on_close)

ws_thread = threading.Thread(target=ws.run_forever)
ws_thread.daemon = True
ws_thread.start()

done.wait(timeout=10)
ws.close()

if screenshot_data:
    with open('/workspace/connect_screen_updated.png', 'wb') as f:
        f.write(base64.b64decode(screenshot_data))
    print("Screenshot saved to /workspace/connect_screen_updated.png")
else:
    print("Failed to capture screenshot")
