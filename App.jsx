import React, { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Check, X, Upload, Map as MapIcon, ListFilter, RefreshCcw } from "lucide-react";
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
  [-72.3622586, 42.1569446],
  [-72.1431943, 42.0317266],
  [-71.7984983, 42.0259886],
  [-71.7974683, 42.0106847],
  [-71.3803312, 42.0219079],
  [-71.3789579, 42.0150212],
  [-70.9872266, 42.0471529],
  [-71.0047361, 42.0792684],
  [-71.0126325, 42.1556685],
  [-71.0764368, 42.2024819],
  [-71.1142024, 42.2024819],
  [-71.2123927, 42.2512934],
  [-71.200033, 42.2777172],
  [-71.2323054, 42.3163168],
  [-71.2426051, 42.3183477],
  [-71.2618311, 42.3427133],
  [-71.1272486, 42.3731571],
  [-71.0915431, 42.3835554],
  [-71.0865649, 42.3929377],
  [-71.1021861, 42.4095435],
  [-71.0546359, 42.4176546],
  [-71.0539492, 42.4317199],
  [-71.104761, 42.4436286],
  [-71.0992678, 42.4778218],
  [-71.1023577, 42.5023787],
  [-71.1016711, 42.5236367],
  [-71.1040743, 42.5360339],
  [-71.104761, 42.5544986],
  [-71.1123141, 42.579531],
  [-71.1219271, 42.6060695],
  [-71.1329134, 42.6452248],
  [-71.1418398, 42.6856174],
  [-71.13772, 42.718417],
  [-71.2633761, 42.6941974],
  [-72.0949038, 42.7156423],
  [-72.0395352, 42.5790287],
  [-72.2661282, 42.2637478],
  [-72.3622586, 42.1569446],
];

const areaFeature = {
  type: "Feature",
  properties: { name: "1A Home Energy Service Area" },
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
  a = a || "";
  b = b || "";
  const m = a.length,
    n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const A = normalizeName(a),
    B = normalizeName(b);
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
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export default function App() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const fittedRef = useRef(false);

  const [cities, setCities] = useState([]);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState([]);
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
        const names = [...new Set(rows.map((r) => (r.NAME || "").trim()).filter(Boolean))];

        // 🔎 Debug – exposes in window + logs counts
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

      if (!map.getSource("service-area")) {
        map.addSource("service-area", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [areaFeature] },
        });
      }

      if (!map.getLayer("area-fill")) {
        map.addLayer({
          id: "area-fill",
          type: "fill",
          source: "service-area",
          paint: { "fill-color": "#ef4444", "fill-opacity": 0.12 },
        });
      }

      if (!map.getLayer("area-outline")) {
        map.addLayer({
          id: "area-outline",
          type: "line",
          source: "service-area",
          paint: { "line-color": "#ef4444", "line-width": 2 },
        });
      }

      if (!fittedRef.current) {
        const [[minLng, minLat], [maxLng, maxLat]] = computeBounds(fernandoPolygon);
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          { padding: 20, animate: false }
        );
        fittedRef.current = true;
      }
    }

    mapInstance.current.on("load", ensureAreaLayer);
    mapInstance.current.on("styledata", ensureAreaLayer);

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
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
          setResult(null);
          setDidYouMean([]);
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
          setResult(null);
          setDidYouMean([]);
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
      const top3 = topFuzzySuggestions(name, cities, 3).filter((s) => s.score >= 0.7);
      setDidYouMean(top3);
    } else {
      setDidYouMean([]);
    }
  }

  function clearAll() {
    setQuery("");
    setResult(null);
    setDidYouMean([]);
  }

  return (
    <div className="min-h-screen w-full bg-gray-50 flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapIcon className="w-6 h-6" />
          <h1 className="text-xl font-semibold">1A Home Energy Service Area — City Checker</h1>
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
            <h2 className="font-medium">Check if a city is within the 1A Home Energy Service Area</h2>
          </div>

          <div className="flex gap-2 items-center">
            <input
              className="flex-1 border rounded-xl px-3 py-2 focus:outline-none focus:ring w-full"
              placeholder="Type a city name (e.g., Framingham)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setResult(null);
                setDidYouMean([]);
              }}
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
            <div
              className={`flex items-center gap-2 rounded-xl px-3 py-3 border ${
                result ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
              }`}
            >
              {result ? <Check className="w-5 h-5 text-green-600" /> : <X className="w-5 h-5 text-red-600" />}
              <div className="font-medium">
                {result ? "City COVERED by the 1A Home Energy Service Area" : "City OUTSIDE the 1A Home Energy Service Area"}
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
                    onClick={() => {
                      setQuery(s.name);
                      checkCity(s.name);
                    }}
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
                  Upload <strong>cidades_area_atendida_1a_home_energy.csv</strong> (column <code className="mx-1">NAME</code>) to enable lookups.
                </p>
                <p className="mt-2">Tip: you can export this list directly from your validated QGIS/CSV.</p>
              </>
            ) : (
              <p>
                {cities.length} cities loaded. Type a city name above and click <em>Check</em>. Matching ignores case and extra spaces.
              </p>
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

      
    </div>
  );
}
