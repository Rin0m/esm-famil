import asyncio
from playwright.async_api import async_playwright
from PIL import Image

URL = "http://localhost:3999/"
OUT = "/home/claude/esm-famil/test/"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome")
        host = await b.new_page(viewport={"width": 900, "height": 950})
        errs = []
        host.on("pageerror", lambda e: errs.append(str(e)))
        await host.goto(URL)
        await host.screenshot(path=OUT + "t_home.png")
        await host.click("#themeBtn")
        await host.screenshot(path=OUT + "t_menu.png")
        await host.click("#themeBtn")
        await host.fill("#name", "Rim")
        await host.click("#createBtn")
        await host.wait_for_selector("#lobby:not(.hidden)")
        code = await host.text_content("#roomCode")
        g = await b.new_page(viewport={"width": 400, "height": 860})
        await g.goto(URL + "?room=" + code)
        await g.fill("#name", "اهورا")
        await g.click("#joinBtn")
        await g.wait_for_selector("#lobby:not(.hidden)")
        await host.screenshot(path=OUT + "t_lobby.png")
        await host.click("#startBtn")
        await g.wait_for_selector("#game:not(.hidden)")
        letter = await g.text_content("#letter")
        shots = []
        for tid in ["kashan", "tabriz", "heriz", "qom", "termeh", "shiraz", "mashhad", "isfahan"]:
            await g.evaluate(f"applyTheme('{tid}')")
            await asyncio.sleep(0.2)
            path = OUT + f"g_{tid}.png"
            await g.screenshot(path=path)
            shots.append(path)
        for pg in (host, g):
            for inp in (await pg.query_selector_all("#fields input")):
                await inp.fill(letter + "ابک")
        await host.click("#stopBtn")
        await host.wait_for_selector("#review:not(.hidden)")
        await host.evaluate("applyTheme('heriz')")
        await host.screenshot(path=OUT + "t_review.png", full_page=True)
        print("errors:", errs)
        ims = [Image.open(s) for s in shots]
        w, h = ims[0].size
        sheet = Image.new("RGB", (w * 4, h * 2))
        for i, im in enumerate(ims):
            sheet.paste(im, ((i % 4) * w, (i // 4) * h))
        sheet.resize((w * 2, h)).save(OUT + "sheet.png")
        await b.close()

asyncio.run(main())
