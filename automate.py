"""
automate.py

Loads the "GraphQL & JSON Network Extractor" Chrome extension (unpacked),
searches Facebook Ad Library for a keyword ("puma" by default) with some
humanlike mouse/typing/scroll behavior, then drives the extension's popup UI
to Extract and Download whatever GraphQL/JSON responses were captured.

Facebook Ad Library is a good target for this: its search results are loaded
almost entirely via GraphQL calls to facebook.com/api/graphql/, so this
should capture plenty of real GraphQL payloads (ad content, targeting info,
pagination cursors, etc).

Notes:
- Extensions require a real (non-headless) Chromium window.
- Facebook's DOM/selectors change often and it may show login walls,
  cookie/consent dialogs, or bot-detection challenges depending on region,
  cookies, and luck. Selectors below use resilient text/role/placeholder
  matching with try/except fallbacks, but you may still need to tweak them.
"""

import asyncio
import random
import re
import sys
from pathlib import Path
import requests

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

BASE_DIR = Path(__file__).parent
EXTENSION_PATH = BASE_DIR / "extension"
USER_DATA_DIR = BASE_DIR / ".chrome-profile"
DOWNLOAD_DIR = BASE_DIR / "downloads"

DEFAULT_SEARCH_TERM = "puma"
COUNTRY = "India"
AD_LIBRARY_URL = "https://www.facebook.com/ads/library/"

# async def → Defines an asynchronous function that must be called with await.

async def human_pause(a: float = 0.25, b: float = 0.7):
    # await asyncio.sleep(...) → Asynchronously waits for that duration without blocking other async tasks.
    await asyncio.sleep(random.uniform(a, b))


async def human_mouse_wander(page, moves: int = 3):
    """Move the mouse to a few semi-random points, like someone glancing
    around the page before doing anything."""
    for _ in range(moves):
        x = random.randint(150, 900)
        y = random.randint(120, 600)
        await page.mouse.move(x, y, steps=random.randint(8, 20))
        await human_pause(0.1, 0.35)


async def human_type(locator, text: str):
    """Click into a field and type character-by-character with irregular
    delays, occasionally pausing briefly like someone thinking."""
    await locator.click()
    await human_pause()
    for ch in text:
        await locator.type(ch, delay=random.uniform(70, 190))
        if random.random() < 0.12:
            await human_pause(0.15, 0.45)


async def human_scroll(page, total_amount: int = 900, steps: int = 8):
    for _ in range(steps):
        await page.mouse.wheel(0, total_amount / steps)
        await human_pause(0.15, 0.4)

async def select_country(page):
    """Select country in Facebook Ad Library."""

    try:
        # Open country selector
        await page.get_by_text("India", exact=True).nth(0).click()

        await human_pause(1, 2)

        # Search for country
        search = page.locator("input[placeholder='Search for country']")
        await search.fill("")
        await human_type(search, COUNTRY)

        await human_pause(1.5, 2.5)

        # Select the country from the results
        await page.get_by_text(COUNTRY, exact=True).click()

        print(f"Selected country: {COUNTRY}")

    except Exception as e:
        print(f"Could not interact with the country selector: {e}")


async def Selects_Advertising_Category(page):
    await page.get_by_text("Ad category", exact=True).nth(0).click()
    await human_pause(0.5, 1.0)

    await page.get_by_text("All ads", exact=True).click()
    await human_pause(0.5, 1.0)



async def type_keyword(page, search_term):
    PLACEHOLDERS = [
        "Choose an ad category",
        "Search by keyword or advertiser",
        "Search by keyword",
        "Search",
    ]
    
    search_box = None

    for placeholder in PLACEHOLDERS:
        try:
            locator = page.get_by_placeholder(
                re.compile(placeholder, re.I)
            )

            await locator.wait_for(state="visible", timeout=2000)

            print(f'✓ Found search box with placeholder: "{placeholder}"')
            search_box = locator
            break

        except PlaywrightTimeoutError:
            continue

    if search_box is None:
        raise Exception("Could not find the search box using any known placeholder.")

    await human_type(search_box, search_term)
    await human_pause(0.4, 0.9)
    await page.keyboard.press("Enter")



async def main():
    search_term = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SEARCH_TERM
    DOWNLOAD_DIR.mkdir(exist_ok=True)

    if not EXTENSION_PATH.exists():
        print(f"Extension folder not found at {EXTENSION_PATH}")
        sys.exit(1)

    async with async_playwright() as p:
        print("Launching Chromium with the extension loaded...")
        context = await p.chromium.launch_persistent_context(
            str(USER_DATA_DIR),
            headless=False,  # extensions require a real, non-headless window
            accept_downloads=True,
            args=[
                f"--disable-extensions-except={EXTENSION_PATH}",
                f"--load-extension={EXTENSION_PATH}",
                "--no-first-run",
            ],
        )

        # --- Grab the extension's background service worker to read its id ---
        background = context.service_workers[0] if context.service_workers else None
        if background is None:
            background = await context.wait_for_event("serviceworker", timeout=5000)
        extension_id = background.url.split("/")[2]
        print("Extension loaded, id:", extension_id)
        
        
        i = 1

        while True:
            res = requests.get(f"http://127.0.0.1:8000/keyword/{i}")
            if res.status_code == 404:
                break
            i += 1
            keyword = res.json()["keyword"]
            print(f">>> Recent Keyword: {keyword}")
            
            page = await context.new_page()
            print(f'Opening Facebook Ad Library and searching for "{search_term}"...')
            await page.goto(AD_LIBRARY_URL, wait_until="domcontentloaded")
            await human_pause(0.5, 1.0)

            await human_mouse_wander(page)

            # Select Country
            await select_country(page)
            await human_mouse_wander(page, moves=2)
            
            # selects the Advertising Category ("All ads")
            await Selects_Advertising_Category(page)
            await human_pause(3, 4)
            
            # Type the ad in the search box
            await type_keyword(page, keyword)

            try:
                await page.wait_for_load_state("networkidle", timeout=30000)
            except PlaywrightTimeoutError:
                pass  # the ad library keeps some long-poll/streaming requests alive
            print("Search results loaded:", page.url)

            # Humanlike browsing of the results — this also naturally triggers
            # more GraphQL calls as additional ads/pagination load in.
            await human_pause(1, 1.8)
            await human_scroll(page, total_amount=700, steps=6)
            await human_pause(1, 2)
            await human_mouse_wander(page, moves=2)
            await human_scroll(page, total_amount=900, steps=8)
            await human_pause(1.5, 2.5)

            # --- Determine the Ad Library tab's real chrome tab id ---
            # Must happen before opening the popup page, since opening a new tab
            # changes which tab chrome considers "active".
            tab_id = await background.evaluate(
                """async () => {
                    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                    return tabs[0] && tabs[0].id;
                }"""
            )
            if not tab_id:
                raise RuntimeError("Could not determine the Ad Library tab's id from the extension.")
            print("Ad Library tab id:", tab_id)

            # --- Open the extension popup directly, targeting that tab ---
            popup = await context.new_page()
            await popup.goto(f"chrome-extension://{extension_id}/popup.html?tabId={tab_id}")

            print('Clicking "Extract"...')
            await popup.click("#extractBtn")
            await popup.wait_for_timeout(1200)

            count_text = await popup.locator("#count").inner_text()
            print(f"Extension reports {count_text} captured response(s).")
            if count_text == "0":
                print(
                    "No JSON/GraphQL responses were captured. Facebook may have shown a "
                    "login wall or the results didn't finish loading — try re-running, "
                    "or increase the wait/scroll time above."
                )

            print('Clicking "Download"...')
            async with popup.expect_download() as download_info:
                await popup.click("#downloadBtn")
            download = await download_info.value

            save_path = DOWNLOAD_DIR / download.suggested_filename
            await download.save_as(str(save_path))
            print("Saved captured data to:", save_path)

        await context.close()


if __name__ == "__main__":
    asyncio.run(main())
