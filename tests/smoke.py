"""Browser regression checks. Run against python3 -m http.server 8000.
Uses the platform's trusted CA for CDN requests; TLS verification stays enabled.
Dependencies: Python playwright and Chromium (provided by the cloud environment).
"""
import json
import os
import ssl
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

context = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE'))
cache = {}
artifacts = Path('/tmp/game05-artifacts')
artifacts.mkdir(exist_ok=True)


def verified_cdn(route):
    url = route.request.url
    if url not in cache:
        with urllib.request.urlopen(url, context=context, timeout=30) as response:
            cache[url] = response.read()
    route.fulfill(status=200, body=cache[url], headers={
        'content-type': 'application/javascript', 'access-control-allow-origin': '*'})


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                               args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
                                     '--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    page.route('https://cdn.jsdelivr.net/**', verified_cdn)
    errors, shaders = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: shaders.append(m.text) if m.type == 'error' else None)
    page.goto('http://127.0.0.1:8000/', wait_until='domcontentloaded')
    page.wait_for_function('(window.__vcd?.car && !document.getElementById("loading")) || document.getElementById("fatalMsg").textContent', timeout=60000)
    assert not page.locator('#fatalMsg').inner_text(), page.locator('#fatalMsg').inner_text()
    page.screenshot(path=str(artifacts/'welcome.png'))
    page.locator('#startDrive').click()
    page.wait_for_function('__vcd.renderer.info.render.triangles > 0')
    # Test actual keyboard mapping in each direction, away from building colliders.
    for key, sign in [('a', 1), ('d', -1)]:
        page.evaluate('__vcd.car.reset(400)')
        page.keyboard.down('w')
        page.wait_for_function('__vcd.car.kmh > 8', timeout=20000)
        before = page.evaluate('__vcd.car.yaw')
        page.keyboard.down(key)
        page.wait_for_function(f'(__vcd.car.yaw - ({before})) * ({sign}) > 0.04', timeout=10000)
        page.keyboard.up(key)
        page.keyboard.up('w')
    page.keyboard.press('r')
    assert page.evaluate('__vcd.car.speed') == 0
    page.keyboard.press('n')
    assert page.locator('#dayButton').inner_text() == '☾'
    page.keyboard.press('n')
    page.keyboard.press('c')
    assert page.locator('#cameraLabel').inner_text() == 'Trong xe'
    page.keyboard.press('c')
    page.keyboard.press('c')
    page.keyboard.press('Escape')
    assert page.locator('#pauseMenu').is_visible()
    page.select_option('#quality', 'high')
    assert page.evaluate('__vcd.quality') == 'high'
    stopped=page.evaluate('({x:__vcd.car.x,z:__vcd.car.z})')
    page.wait_for_timeout(200)
    assert page.evaluate('({x:__vcd.car.x,z:__vcd.car.z})') == stopped
    page.select_option('#quality', 'balanced')
    page.locator('#resumeDrive').click()
    page.evaluate('__vcd.car.reset(3060)')
    page.wait_for_timeout(900)
    page.screenshot(path=str(artifacts/'drive.png'))
    page.locator('#mapBox').click()
    assert page.locator('#mapDialog').is_visible()
    assert page.evaluate('__vcd.paused')
    zoom = page.evaluate('__vcd.map.zoom')
    page.locator('#zoomIn').click()
    assert page.evaluate('__vcd.map.zoom') > zoom
    page.locator('#zoomOut').click()
    map_canvas=page.locator('#detailMap').bounding_box()
    center_before=page.evaluate('__vcd.map.center')
    page.mouse.move(map_canvas['x']+200,map_canvas['y']+200)
    page.mouse.down()
    page.mouse.move(map_canvas['x']+240,map_canvas['y']+220,steps=5)
    page.mouse.up()
    assert page.evaluate('__vcd.map.center') != center_before
    old_zoom=page.evaluate('__vcd.map.zoom')
    page.mouse.wheel(0,-250)
    page.wait_for_function(f'__vcd.map.zoom > {old_zoom}')
    page.locator('[data-stage="3"]').click()
    assert page.evaluate('__vcd.map.zoom') == 3
    page.locator('#mapFit').click()
    page.screenshot(path=str(artifacts/'map.png'))
    page.locator('[data-stage="3"]').click()
    page.locator('[data-travel="3"]').click()
    assert not page.locator('#mapDialog').is_visible()
    page.wait_for_function('document.getElementById("district").textContent === "Bãi Dài"')
    page.screenshot(path=str(artifacts/'beach.png'))
    # All sections render with the sky visible, including the far north/south.
    for index,z in enumerate([3060,2200,1040,-200,-1460,-3060]):
        page.evaluate(f'__vcd.car.reset({z})')
        page.wait_for_timeout(250)
        assert page.evaluate('__vcd.scene.getObjectByName("sky").visible')
        assert page.evaluate('__vcd.renderer.info.render.triangles > 0')
        page.screenshot(path=str(artifacts/f'stage-{index+1}.png'))
    # Map Escape returns to driving, without a second pause menu appearing.
    page.keyboard.press('m')
    page.keyboard.press('Escape')
    assert not page.locator('#mapDialog').is_visible()
    page.wait_for_function('!__vcd.paused', timeout=5000)
    assert not page.locator('#pauseMenu').is_visible()
    # Check reversal and fixed-step physics independent of frame timing.
    physics = page.evaluate('''async () => {
      const {Vehicle}=await import('./vehicle.js');
      const w={resolve:()=>null};
      const input={throttle:1,brake:0,steer:0,handbrake:false};
      const a=new Vehicle(w),b=new Vehicle(w);a.reset(0);b.reset(0);
      for(let i=0;i<240;i++)a.update(1/120,input);
      for(let i=0;i<120;i++)b.update(1/60,input);
      const difference=Math.hypot(a.x-b.x,a.z-b.z);
      for(let i=0;i<400;i++)a.update(1/120,{...input,throttle:0,brake:1});
      return {difference,reverse:a.speed<0,finite:[a.x,a.y,a.z,a.yaw].every(Number.isFinite)};
    }''')
    assert physics['difference'] < .3, physics
    assert physics['reverse'] and physics['finite'], physics
    assert not errors, errors
    assert not [s for s in shaders if 'favicon' not in s], shaders
    mobile = browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    m = mobile.new_page()
    m.route('https://cdn.jsdelivr.net/**', verified_cdn)
    m.on('pageerror', lambda e: errors.append(str(e)))
    m.goto('http://127.0.0.1:8000/', wait_until='domcontentloaded')
    m.wait_for_function('window.__vcd?.car && !document.getElementById("loading")', timeout=60000)
    m.locator('#startDrive').tap()
    assert m.locator('#tGas').is_visible()
    assert m.locator('#tLeft').is_visible()
    assert m.evaluate('__vcd.quality') == 'low'
    session=mobile.new_cdp_session(m)
    gas=m.locator('#tGas').bounding_box()
    gx,gy=gas['x']+gas['width']/2,gas['y']+gas['height']/2
    session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':gx,'y':gy,'id':1}]})
    m.wait_for_function('__vcd.car.kmh > 3',timeout=20000)
    session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    m.wait_for_function('document.getElementById("throttleFill").style.width === "0%"')
    m.screenshot(path=str(artifacts/'mobile.png'))
    m.locator('#mapBox').tap()
    m.locator('#zoomIn').tap()
    assert m.evaluate('__vcd.map.zoom') > 1
    bounds=m.locator('#detailMap').bounding_box()
    cx,cy=bounds['x']+bounds['width']/2,bounds['y']+bounds['height']/2
    start_zoom=m.evaluate('__vcd.map.zoom')
    session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':cx-30,'y':cy,'id':1},{'x':cx+30,'y':cy,'id':2}]})
    session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':cx-60,'y':cy,'id':1},{'x':cx+60,'y':cy,'id':2}]})
    session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':cx-90,'y':cy,'id':1},{'x':cx+90,'y':cy,'id':2}]})
    session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    assert m.evaluate('__vcd.map.zoom') > start_zoom
    m.screenshot(path=str(artifacts/'mobile-map.png'))
    m.locator('#mapClose').tap()
    assert not errors, errors
    print(json.dumps({'desktop':'passed','mobile':'passed','physics':physics,
                      'page_errors':errors,'artifacts':str(artifacts)},ensure_ascii=False),flush=True)
    browser.close()
