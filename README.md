# SPORTKIT.hive

Custom team kits, match balls and gear with a live 3D designer, a storefront with team
pricing and order tracking, and an admin panel (orders, products, discounts, payments,
analytics, ad studio, autopilot, design lab and vendor scouts).

## Run it locally

    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    DATA_DIR=./data .venv/bin/uvicorn main:app --port 8080

Open http://localhost:8080 for the store and http://localhost:8080/admin for the admin.
The first visit to the admin asks you to choose an admin password.

## Run it with Docker

    docker build -t sportkit-hive .
    docker run -p 8080:8080 -v sportkit-data:/data sportkit-hive

## Layout

- `main.py`, `backend/`: FastAPI server (API, admin, pricing, helper agents)
- `seed/`: starting catalog, leagues and store settings, loaded on first boot
- `static/`: the website (HTML, CSS, JavaScript, fonts)
- `static/js/gear3d.js` and `static/js/gear/`: the procedural 3D product models
- `static/js/admin/ads.js`: ad studio (frame-exact MP4 video export)
- All saved data (database, uploads) lives in `DATA_DIR` (default `/data`).

## Third-party code

- three.js (MIT) in `static/vendor/three/`
- mp4-muxer (MIT) in `static/vendor/mp4-muxer/`
- qrcode generator in `static/vendor/qrcode/`
- Fonts in `static/fonts/` are open source (SIL Open Font License)
