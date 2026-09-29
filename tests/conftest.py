import os
import shutil
import socketserver
import http.server
import threading
import pytest
from playwright.sync_api import sync_playwright

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VIDEOS_DIR = os.path.join(REPO_ROOT, "test-artifacts", "videos")
SCREENSHOTS_DIR = os.path.join(REPO_ROOT, "test-artifacts", "screenshots")

os.makedirs(VIDEOS_DIR, exist_ok=True)
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

class QuietHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO_ROOT, **kwargs)

    def log_message(self, format, *args):
        # Suppress standard access logging to keep test output clean
        pass

@pytest.fixture(scope="session")
def app_server():
    """
    Starts a lightweight ephemeral HTTP server on 127.0.0.1 serving the repository directory.
    This gives the browser true HTTP origin semantics, avoiding file protocol restrictions and CORS blocks.
    """
    server = socketserver.TCPServer(("127.0.0.1", 0), QuietHTTPHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{port}"
    yield base_url
    server.shutdown()
    server.server_close()

@pytest.fixture(scope="session")
def local_file_url():
    """
    Returns the direct file URL (e.g. file:///.../index.html)
    for testing direct file:// access without a web server.
    """
    index_path = os.path.join(REPO_ROOT, "index.html")
    normalized = index_path.replace("\\", "/")
    if not normalized.startswith("/"):
        normalized = "/" + normalized
    return f"file:{normalized}"

@pytest.fixture(scope="session")
def browser_channel():
    """
    Detects which system Chromium browser is available (Chrome or Edge).
    """
    chrome_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for p in chrome_paths:
        if os.path.exists(p):
            return "chrome"
    return "msedge"

@pytest.fixture(scope="function")
def visual_page(request, browser_channel):
    """
    Launches a browser session with video recording and console error tracking enabled.
    Saves a recorded .webm video named after the test to test-artifacts/videos/<test_name>.webm.
    """
    test_name = request.node.name
    temp_video_dir = os.path.join(VIDEOS_DIR, f"_temp_{test_name}")
    os.makedirs(temp_video_dir, exist_ok=True)

    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel=browser_channel,
            headless=True,
            args=["--allow-file-access-from-files"]
        )
        context = browser.new_context(
            record_video_dir=temp_video_dir,
            record_video_size={"width": 1280, "height": 960},
            viewport={"width": 1280, "height": 960}
        )
        page = context.new_page()

        # Monitor console errors and uncaught exceptions
        page.on("console", lambda msg: console_errors.append(f"Console {msg.type}: {msg.text}") if msg.type in ("error", "warning") else None)
        page.on("pageerror", lambda err: console_errors.append(f"PageError: {err}"))

        # Attach helper attributes
        page.console_errors = console_errors
        page.screenshots_dir = SCREENSHOTS_DIR

        def save_screenshot(filename: str):
            path = os.path.join(SCREENSHOTS_DIR, filename)
            page.screenshot(path=path)
            return path

        page.save_screenshot = save_screenshot

        yield page

        # Finalize video recording
        raw_video_path = page.video.path() if page.video else None
        context.close()
        browser.close()

        if raw_video_path and os.path.exists(raw_video_path):
            target_video_file = os.path.join(VIDEOS_DIR, f"{test_name}.webm")
            if os.path.exists(target_video_file):
                os.remove(target_video_file)
            shutil.move(raw_video_path, target_video_file)

        # Cleanup temp directory
        try:
            shutil.rmtree(temp_video_dir, ignore_errors=True)
        except Exception:
            pass
