import asyncio
from playwright.async_api import async_playwright
URL = "http://localhost:3999/"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome")
        h = await b.new_page(); errs = []
        h.on("pageerror", lambda e: errs.append(str(e)))
        await h.goto(URL); await h.fill("#name", "Bb"); await h.click("#createBtn")
        await h.wait_for_selector("#lobby:not(.hidden)")
        await h.fill("#sTime", "10"); await h.click("#startBtn")
        await h.wait_for_selector("#review:not(.hidden)", timeout=20000)   # Zeit läuft ab, wie im Screenshot
        await h.click("#confirmBtn")
        await h.wait_for_selector("#lobby:not(.hidden)", timeout=3000)
        print("Klick auf Bestätigen -> Lobby: OK")
        await h.click("#startBtn"); await h.wait_for_selector("#game:not(.hidden)")
        letter = await h.text_content("#letter")
        for inp in await h.query_selector_all("#fields input"): await inp.fill(letter + "ا")
        await h.click("#stopBtn"); await h.wait_for_selector("#review:not(.hidden)")
        await h.click("td.click"); await asyncio.sleep(0.3)
        print("Zelle nach Klick:", await h.get_attribute("td.click", "class"))
        await h.click("#confirmBtn"); await h.wait_for_selector("#lobby:not(.hidden)", timeout=3000)
        print("Punkte:", await h.text_content("#playerList"))
        print("errors:", errs); await b.close()
asyncio.run(main())
