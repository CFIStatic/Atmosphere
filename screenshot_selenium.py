from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
import time

# Setup Chrome options
chrome_options = Options()
chrome_options.add_argument('--headless')
chrome_options.add_argument('--no-sandbox')
chrome_options.add_argument('--disable-dev-shm-usage')
chrome_options.add_argument('--disable-gpu')

try:
    # Create driver
    driver = webdriver.Chrome(options=chrome_options)
    
    # Navigate to page
    driver.get('http://127.0.0.1:4177/index.html')
    time.sleep(2)  # Wait for page to load
    
    # Take screenshot
    driver.save_screenshot('/workspace/connect_screen_updated.png')
    
    # Get the helper text
    body = driver.find_element('tag name', 'body')
    print("Page loaded successfully")
    print("Helper text element found")
    
    driver.quit()
    print("Screenshot saved to /workspace/connect_screen_updated.png")
except Exception as e:
    print(f"Error: {e}")
