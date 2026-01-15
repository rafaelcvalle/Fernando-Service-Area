import React, { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Check, X, Upload, Map as MapIcon, ListFilter, RefreshCcw, Beaker } from "lucide-react";
import citiesCsvUrl from "./cidades_area_atendida_1a_home_energy.csv?url";

// Offline-safe blank style
const LOCAL_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};


// Polygon coordinates [lng, lat]
const fernandoPolygon = [
  [-72.365441, 42.1574638], [-72.1429679, 42.0321229], [-71.7996451, 42.023962],
  [-71.7996451, 42.0096781], [-71.3849112, 42.0198812], [-70.9811637, 42.0484414],
  [-71.0264823, 42.1727323], [-71.0786673, 42.202241],   [-71.1404654, 42.2093618],
  [-71.2077567, 42.24597],   [-71.2118765, 42.2591844],  [-71.2008902, 42.2754445],
  [-71.2214896, 42.298811],  [-71.2585684, 42.342473],   [-71.2723014, 42.3627706],
  [-71.2681815, 42.3820472], [-71.2585684, 42.4286925],  [-71.2571951, 42.4580815],
  [-71.2448355, 42.4722643], [-71.2159964, 42.4773288],  [-71.2887808, 42.5481891],
  [-71.3258597, 42.6088625], [-71.3107535, 42.577522],   [-71.412377, 42.5765107],
  [-72.0358512, 42.5684201], [-72.0427176, 42.5330115],  [-71.9864127, 42.4479489],
  [-72.1045157, 42.4226103], [-72.1278617, 42.4063882],  [-72.1251151, 42.3759605],
  [-72.2020194, 42.3089677], [-72.2212454, 42.2632498],  [-72.2528311, 42.258168],
  [-72.28991, 42.2347864],   [-72.365441, 42.1574638],
];

const areaFeature = {
  type: "Feature",
  properties: { name: "Fernando Service Area" },
  geometry: { type: "Polygon", coordinates: [fernandoPolygon] },
};

// Normalization
function normalizeName(s) {
  return (s || "")
    .toString()
    .replace(/\s+/g, " ")
    .replace(/\b(town|city)\b$/i, "")
    .trim()
    .toLowerCase();
}

// Levenshtein + similarity for fuzzy suggestions
function levenshtein(a, b) {
  a = a || ""; b = b || "";
  const m = a.length, n = b.length;
  if (m === 0) return n; if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const A = normalizeName(a), B = normalizeName(b);
  const maxLen = Math.max(A.length, B.length) || 1;
  return 1 - levenshtein(A, B) / maxLen;
}

function topFuzzySuggestions(query, options, k = 3) {
  const Q = normalizeName(query);
  const scored = options.map((opt) => ({ name: opt, score: similarity(Q, opt) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function extractCityNames(rows) {
  const parsed = rows
    .map((r) => r.NAME || r.City || r.CITY || r.NAMELSAD || "")
    .map((s) => s.toString())
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(parsed)).sort((a, b) => a.localeCompare(b));
}

function computeBounds(coords) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

export default function App() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const fittedRef = useRef(false);
  const [cities, setCities] = useState([]);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState([]);
  const [testReport, setTestReport] = useState(null);
  const [didYouMean, setDidYouMean] = useState([]);

useEffect(() => {
  async function loadCities() {
    try {
      const envUrl = import.meta.env?.VITE_CITIES_CSV_URL;
      const url = envUrl || citiesCsvUrl;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();

      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const rows = parsed.data || [];
      const names = [...new Set(rows.map(r => (r.NAME || "").trim()).filter(Boolean))];

      // 🔎 Debug – expõe no window e loga contagens
      if (typeof window !== "undefined") {
        window.__rawCities = rows;
        window.__loadedCities = names;
        console.log("RAW rows:", rows.length);
        console.log("UNIQUE names:", names.length);
        console.log("Has Lexington?", names.includes("Lexington"));
        console.log("Has Burlington?", names.includes("Burlington"));
      }

      setCities(names);
      setPreview(names.map((n, i) => ({ idx: i + 1, name: n })));
    } catch (e) {
      console.error("Failed to auto-load cities:", e);
    }
  }
  loadCities();
}, []);


  useEffect(() => {
    if (mapInstance.current) return;

    mapInstance.current = new maplibregl.Map({
      container: mapRef.current,
      style: LOCAL_STYLE,
      attributionControl: true,
      center: [-71.4, 42.3],
      zoom: 7,
    });

    function ensureAreaLayer() {
      const map = mapInstance.current;
      if (!map) return;
      if (!map.getSource("fernando-area")) {
        map.addSource("fernando-area", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [areaFeature] },
        });
      }
      if (!map.getLayer("area-fill")) {
        map.addLayer({ id: "area-fill", type: "fill", source: "fernando-area", paint: { "fill-color": "#ef4444", "fill-opacity": 0.12 } });
      }
      if (!map.getLayer("area-outline")) {
        map.addLayer({ id: "area-outline", type: "line", source: "fernando-area", paint: { "line-color": "#ef4444", "line-width": 2 } });
      }
      if (!fittedRef.current) {
        const [[minLng, minLat], [maxLng, maxLat]] = computeBounds(fernandoPolygon);
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 20, animate: false });
        fittedRef.current = true;
      }
    }

    mapInstance.current.on("load", ensureAreaLayer);
    mapInstance.current.on("styledata", ensureAreaLayer);

    return () => { mapInstance.current?.remove(); mapInstance.current = null; };
  }, []);

  const suggestions = useMemo(() => {
    if (!query) return cities.slice(0, 10);
    const q = normalizeName(query);
    return cities.filter((c) => normalizeName(c).includes(q)).slice(0, 12);
  }, [query, cities]);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = (file.name.split(".").pop() || "").toLowerCase();

    if (ext === "csv") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          const rows = res.data || [];
          const uniq = extractCityNames(rows);
          setCities(uniq);
          setPreview(uniq.map((n, i) => ({ idx: i + 1, name: n })));
          setResult(null); setTestReport(null); setDidYouMean([]);
        },
        error: (err) => alert("Error reading CSV: " + err?.message),
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheet = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheet];
          const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
          const uniq = extractCityNames(rows);
          setCities(uniq);
          setPreview(uniq.map((n, i) => ({ idx: i + 1, name: n })));
          setResult(null); setTestReport(null); setDidYouMean([]);
        } catch (err) {
          alert("Error reading Excel: " + (err?.message || err));
        }
      };
      reader.onerror = () => alert("Could not read Excel file.");
      reader.readAsArrayBuffer(file);
    } else {
      alert("Unsupported format. Please upload .csv or .xlsx");
    }
  }

  function checkCity(name) {
    const exists = cities.map(normalizeName).includes(normalizeName(name));
    setResult(exists ? true : false);

    if (!exists && name && cities.length > 0) {
      const top3 = topFuzzySuggestions(name, cities, 3).filter(s => s.score >= 0.7);
      setDidYouMean(top3);
    } else {
      setDidYouMean([]);
    }
  }

  function clearAll() { setQuery(""); setResult(null); setDidYouMean([]); }

  function runSelfTests() {
    const tests = [];
    if (cities.length > 0) {
      const sample = cities[0];
      tests.push({ name: `Existing city: ${sample}`, pass: cities.includes(sample) });
      const miss = sample.slice(0, Math.max(1, sample.length - 1));
      const sugg = topFuzzySuggestions(miss, cities, 1)[0];
      tests.push({ name: "Fuzzy suggestion for near-miss", pass: !!sugg && normalizeName(sugg.name) === normalizeName(sample) });
    } else {
      tests.push({ name: "CSV loaded", pass: false, info: "Upload the CSV before running tests." });
    }
    tests.push({ name: "Excluded (Concord)", pass: !cities.map(normalizeName).includes(normalizeName("Concord")) });
    tests.push({ name: "Excluded (Hudson)", pass: !cities.map(normalizeName).includes(normalizeName("Hudson")) });
    tests.push({ name: "Excluded (Littleton)", pass: !cities.map(normalizeName).includes(normalizeName("Littleton")) });

    if (cities.length > 0) {
      const any = cities[0];
      tests.push({ name: "Case-insensitive match", pass: cities.map(normalizeName).includes(normalizeName(any.toUpperCase())) });
      tests.push({ name: "Extra spaces tolerated", pass: cities.map(normalizeName).includes(normalizeName(`  ${any}  `)) });
    }

    const passed = tests.every((t) => t.pass === true);
    setTestReport({ passed, tests });
  }

  return (
    <div className="min-h-screen w-full bg-gray-50 flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapIcon className="w-6 h-6" />
          <h1 className="text-xl font-semibold">Fernando Service Area — City Checker</h1>
        </div>
       
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Map */}
        <div className="lg:col-span-2 rounded-2xl overflow-hidden shadow">
          <div ref={mapRef} style={{ height: 500, width: "100%" }} />
        </div>

        {/* Search & Status */}
        <div className="bg-white rounded-2xl shadow p-4 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <ListFilter className="w-4 h-4" />
            <h2 className="font-medium">Check if a city is within the Fernando Service Area</h2>
          </div>

          <div className="flex gap-2 items-center">
            <input
              className="flex-1 border rounded-xl px-3 py-2 focus:outline-none focus:ring w-full"
              placeholder="Type a city name (e.g., Framingham)"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setResult(null); setDidYouMean([]); }}
              list="city-suggestions"
            />
            <button
              className="px-3 py-2 rounded-xl bg-black text-white hover:opacity-90"
              onClick={() => checkCity(query)}
              disabled={!query || cities.length === 0}
              title={cities.length === 0 ? "Upload the 99-city CSV first" : "Check"}
            >
              Check
            </button>
            <button className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200" onClick={clearAll}>
              <RefreshCcw className="w-4 h-4" />
            </button>
          </div>

          <datalist id="city-suggestions">
            {suggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          {result !== null && (
            <div className={`flex items-center gap-2 rounded-xl px-3 py-3 border ${result ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
              {result ? <Check className="w-5 h-5 text-green-600" /> : <X className="w-5 h-5 text-red-600" />}
              <div className="font-medium">
                {result ? "City COVERED by the Fernando Service Area" : "City OUTSIDE the Fernando Service Area"}
              </div>
            </div>
          )}

          {didYouMean.length > 0 && result === false && (
            <div className="rounded-xl px-3 py-3 border bg-yellow-50 border-yellow-200">
              <div className="font-medium mb-2">Did you mean:</div>
              <div className="flex flex-wrap gap-2">
                {didYouMean.map((s) => (
                  <button
                    key={s.name}
                    className="px-3 py-1 rounded-full bg-white border hover:bg-gray-50 text-sm"
                    title={`Similarity ${(s.score * 100).toFixed(0)}%`}
                    onClick={() => { setQuery(s.name); checkCity(s.name); }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="text-sm text-gray-600">
            {cities.length === 0 ? (
              <>
                <p>
                  Upload <strong>cidades_filtradas_ng_ou_eversource.csv</strong> (column <code className="mx-1">NAME</code>) to enable lookups.
                </p>
                <p className="mt-2">Tip: you can export this list directly from your validated QGIS/CSV.</p>
              </>
            ) : (
              <p>
                {cities.length} cities loaded. Type a city name above and click <em>Check</em>. Matching ignores case and extra spaces.
              </p>
            )}
          </div>

          <div className="border rounded-2xl p-3 text-sm">
            <div className="flex items-center gap-2 mb-2">
              <Beaker className="w-4 h-4" />
              <span className="font-medium">Self‑tests</span>
            </div>
            <button
              className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200"
              onClick={runSelfTests}
              disabled={cities.length === 0}
              title={cities.length === 0 ? "Upload the CSV first" : "Run tests"}
            >
              Run tests
            </button>
            {testReport && (
              <div className="mt-2">
                <div className={`font-medium ${testReport.passed ? "text-green-700" : "text-red-700"}`}>
                  {testReport.passed ? "All tests passed" : "Some tests failed"}
                </div>
                <ul className="list-disc pl-5 mt-1">
                  {testReport.tests.map((t, idx) => (
                    <li key={idx} className={t.pass ? "text-green-700" : "text-red-700"}>
                      {t.name}: {t.pass ? "OK" : "Failed"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </main>

      <section className="bg-white rounded-2xl shadow p-4 mt-4">
        <h3 className="font-medium mb-2">Loaded cities</h3>
        {preview.length === 0 ? (
          <p className="text-sm text-gray-600">No cities loaded yet.</p>
        ) : (
          <div className="max-h-64 overflow-auto border rounded-2xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left p-2 w-16">#</th>
                  <th className="text-left p-2">City</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.idx} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2 text-gray-500">{row.idx}</td>
                    <td className="p-2">{row.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="text-xs text-gray-500 mt-4">
        <p>Tip: to add future regions (e.g., “João Service Area”), swap the CSV and/or polygon. I can extend this to multiple technicians.</p>
      </footer>
    </div>
  );
}
