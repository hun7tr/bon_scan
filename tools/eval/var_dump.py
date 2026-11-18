# mehrere Aufbereitungs-Varianten je Bild lesen und speichern
import asyncio, json, sys, os, time
from playwright.async_api import async_playwright
DS, OUT, VARS = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
imgs = sorted(os.listdir(f'/home/claude/{DS}/images'))
res = {}
async def worker(b, q):
    page = await (await b.new_context()).new_page()
    await page.goto('http://localhost:8765/bon_scan/index.html?var' + str(time.time()))
    await page.wait_for_function("BonOCR.state.status==='ready'", timeout=120000)
    while q:
        f = q.pop(); key = f.rsplit('.', 1)[0]
        res[key] = await page.evaluate("""async ([src, vars]) => { const c = await BonOCR.fileToCanvas(await (await fetch(src)).blob()); return BonOCR._variants(c, vars); }""", [f'/{DS}/images/{f}', VARS])
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        q = list(reversed(imgs))
        await asyncio.gather(*[worker(b, q) for _ in range(5)])
        await b.close()
    json.dump(res, open(OUT, 'w'))
asyncio.run(main())
