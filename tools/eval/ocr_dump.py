# Echte App-Pipeline (Bildaufbereitung + Tesseract.js) auf alle Bilder anwenden, Rohzeilen speichern
import asyncio, json, sys, os, time
from playwright.async_api import async_playwright
DS, OUT, WORKERS = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 4
imgs = sorted(os.listdir(f'/home/claude/{DS}/images'))
res = json.load(open(OUT)) if os.path.exists(OUT) and '--resume' in sys.argv else {}
async def worker(b, q):
    page = await (await b.new_context()).new_page()
    await page.goto('http://localhost:8765/' + os.environ.get('APPDIR', 'bon_scan') + '/index.html?eval' + str(time.time()))
    await page.wait_for_function("BonOCR.state.status==='ready'", timeout=120000)
    while q:
        f = q.pop()
        key = f.rsplit('.', 1)[0]
        if key in res: continue
        t = time.time()
        r = await page.evaluate("""async (src) => { const c = await BonOCR.fileToCanvas(await (await fetch(src)).blob());
            const rs = await BonOCR.recognize(c); return rs.map(x => ({ conf: x.confidence, lines: x.lines })); }""", f'/{DS}/images/{f}')
        res[key] = r
        print(key, round(time.time() - t, 1), [x['conf'] for x in r], flush=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        q = list(reversed(imgs))
        await asyncio.gather(*[worker(b, q) for _ in range(WORKERS)])
        await b.close()
    json.dump(res, open(OUT, 'w'))
asyncio.run(main())
