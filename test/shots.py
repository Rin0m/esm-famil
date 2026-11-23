import asyncio
from playwright.async_api import async_playwright

URL = "http://localhost:3999/"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome")
        host = await b.new_page(viewport={"width": 900, "height": 1000})
        await host.goto(URL)
        await host.fill("#name", "Rim")
        await host.click("#createBtn")
        await host.wait_for_selector("#lobby:not(.hidden)")
        code = await host.text_content("#roomCode")
        guests = []
        for n in ["اهورا", "Juan"]:
            g = await b.new_page(viewport={"width": 420, "height": 900})
            await g.goto(URL + "?room=" + code)
            await g.fill("#name", n)
            await g.click("#joinBtn")
            await g.wait_for_selector("#lobby:not(.hidden)")
            guests.append(g)
        await host.screenshot(path="/home/claude/esm-famil/test/1_lobby.png", full_page=True)
        await host.fill("#sTime", "20")
        await host.click("#startBtn")
        await host.wait_for_selector("#game:not(.hidden)")
        letter = await host.text_content("#letter")
        words = {"Rim": ["الف"], }
        pages = [host] + guests
        for i, pg in enumerate(pages):
            inputs = await pg.query_selector_all("#fields input")
            for j, inp in enumerate(inputs):
                if i == 2 and j > 3: break
                await inp.fill(letter + ["ابک", "شهر", "ستان", "رود", "وت", "ش", "ج", "یز"][j % 8] + ("" if i else "ی"))
        await asyncio.sleep(0.6)
        await guests[0].screenshot(path="/home/claude/esm-famil/test/2_game_mobile.png", full_page=True)
        await host.click("#stopBtn")
        await host.wait_for_selector("#review:not(.hidden)")
        await host.screenshot(path="/home/claude/esm-famil/test/3_review.png", full_page=True)
        # Sprache wechseln
        await guests[1].click("button[data-lang=de]")
        await guests[1].screenshot(path="/home/claude/esm-famil/test/4_review_de.png", full_page=True)
        await b.close()

asyncio.run(main())
