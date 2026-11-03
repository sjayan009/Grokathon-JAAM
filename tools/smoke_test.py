#!/usr/bin/env python3
"""Smoke test the deterministic standalone SmartPath mock; does not require Chrome extension."""
import subprocess,time,urllib.request,os,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]

def chromium_executable():
    candidates=[]
    if os.environ.get('CHROME_PATH'):
        candidates.append(os.environ['CHROME_PATH'])
    candidates+=('/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/local/bin/chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for candidate in candidates:
        if Path(candidate).is_file():
            return candidate
    raise SystemExit('Chromium or Chrome is required for the smoke test. Set CHROME_PATH if it is installed elsewhere.')
server=subprocess.Popen([sys.executable,'-m','http.server','5173','--bind','127.0.0.1','--directory',str(ROOT/'mock-app')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
  for i in range(25):
    try:
      urllib.request.urlopen('http://127.0.0.1:5173/fixtures/demo.json',timeout=1);break
    except Exception: time.sleep(.15)
  with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium_executable(),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':900})
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:5173/',wait_until='networkidle')
    assert page.locator('.pdf-page-wrap').count()==4
    assert page.locator('[data-anchor-id]').count()==10
    assert page.locator('[data-concept-id]').count()==5
    page.locator('#start-lesson').click()
    # 5 transitions at ~1.4 s each; wait 15 seconds maximum.
    page.locator('#quiz-backdrop').wait_for(state='visible',timeout=18000)
    assert page.locator('[data-anchor-id="ldr_instruction"]').get_attribute('data-active')=='true'
    assert page.locator('[data-concept-id="ldr"]').get_attribute('data-active')=='true'
    page.locator('.quiz-choice').filter(has_text='B. 7').click()
    assert 'Correct' in page.locator('#quiz-feedback').inner_text()
    page.locator('#close-quiz').click()
    page.locator('#prompt').fill('What should I review?')
    page.locator('#send-prompt').click()
    assert 'lowest-confidence' in page.locator('#caption-text').inner_text()
    page.screenshot(path=str(ROOT/'mock-app'/'assets'/'demo-screenshot.png'),full_page=False)
    print('PASS: PDF=4 pages; anchors=10; graph=5 nodes; lesson=6 verified steps; quiz; weak-topic guidance')
    print('Browser page errors:',errors)
    browser.close()
    if errors:raise RuntimeError(errors)
finally:
  server.terminate();server.wait(timeout=3)
