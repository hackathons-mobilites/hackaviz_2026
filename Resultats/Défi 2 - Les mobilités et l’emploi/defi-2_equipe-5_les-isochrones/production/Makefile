# Pipeline steps run from isochrones/ (flat imports); pages are written to app/static/
PY = .venv/bin/python

.PHONY: prim setup data all network zones tt od modes hubs analysis web scenario story staggered equal solutions

setup:
	uv sync

data:
	bash isochrones/download_data.sh

network:
	cd isochrones && ../$(PY) prepare_gtfs.py

zones:
	cd isochrones && ../$(PY) zones.py

tt: network zones
	cd isochrones && ../$(PY) accessibility.py

od: zones
	cd isochrones && ../$(PY) od.py

hubs: od
	cd isochrones && ../$(PY) hubs.py

modes: zones
	cd isochrones && ../$(PY) fetch_modes.py

analysis: hubs modes
	cd isochrones && ../$(PY) analysis.py

web: analysis
	cd isochrones && ../$(PY) build_web.py

scenario: tt
	cd isochrones && ../$(PY) scenario_gpe.py && ../$(PY) accessibility.py 8 network_gpe.npz tt_pt_peak_gpe.npz && ../$(PY) scenario_compare.py

staggered: tt
	cd isochrones && ../$(PY) prepare_gtfs.py --start 03:30 --end 09:00 --out network_early.npz && \
	../$(PY) prepare_gtfs.py --start 21:00 --end 27:30 --out network_late.npz && \
	../$(PY) prepare_gtfs.py --date 20261122 --start 06:00 --end 11:00 --out network_sunday.npz && \
	../$(PY) prepare_gtfs.py --start 16:00 --end 21:30 --out network_evening.npz && \
	../$(PY) accessibility.py 8 network_early.npz tt_pt_early.npz 04:30-06:00/5 && \
	../$(PY) accessibility.py 8 network_late.npz tt_pt_late.npz 22:00-24:30/5 && \
	../$(PY) accessibility.py 8 network_sunday.npz tt_pt_sunday.npz 07:00-09:00/5 && \
	../$(PY) accessibility.py 8 network_evening.npz tt_pt_evening.npz 17:00-19:00/5 && \
	../$(PY) staggered.py

equal: analysis
	cd isochrones && ../$(PY) equal_access.py

solutions: analysis
	cd isochrones && ../$(PY) accessibility_bike.py 8 && ../$(PY) solutions.py

prim:
	cd isochrones && ../$(PY) prim_service_cycling.py

story: web scenario staggered equal solutions prim
	cd isochrones && ../$(PY) build_story.py

all: tt analysis web scenario story staggered equal solutions
