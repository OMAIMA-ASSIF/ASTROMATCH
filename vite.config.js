import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var dataFiles = {
    "cells.csv": "clustring/kmeans_cells.csv",
    "profiles.csv": "outputs/cluster_numeric_profiles.csv",
    "feature-coverage.csv": "outputs/cluster_feature_coverage.csv",
    "geology.csv": "outputs/cluster_geological_composition.csv",
    "geology-coverage.csv": "outputs/cluster_geological_coverage.csv",
    "label-summary.csv": "outputs/cluster_label_summary.csv",
    "enrichment-manifest.json": "outputs/astromatch_enrichment_manifest.json",
    "preprocessing.json": "clustring/preprocessing.json",
    "mission-sites.csv": "mission_data/processed/mission_reference_sites.csv",
    "screening-regions.csv": "outputs/astromatch/analogue_regions.csv",
    "mission-coverage.csv": "outputs/astromatch/matching_coverage_report.csv",
    "mission-compatibility.csv": "mission_data/scoring/feature_compatibility_final.csv",
    "mission-reference-details.json": "outputs/astromatch/mission_reference_details.json",
    "mission-earth-context.csv": "outputs/astromatch_enriched_earth.csv",
    "screening-run-manifest.json": "outputs/astromatch/matching_run_manifest.json",
};
function existingCsvPlugin() {
    var serveCsv = function (req, res, next) {
        var _a;
        var fileName = ((_a = req.url) !== null && _a !== void 0 ? _a : "").split("?")[0].replace(/^\/+/, "");
        var relativePath = dataFiles[fileName];
        if (!relativePath) {
            next();
            return;
        }
        res.setHeader("Content-Type", fileName.endsWith(".json") ? "application/json; charset=utf-8" : "text/csv; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(resolve(process.cwd(), relativePath))
            .on("error", function () {
            if (!res.headersSent)
                res.statusCode = 500;
            res.end("Unable to read the existing ASTROMATCH CSV file.");
        })
            .pipe(res);
    };
    return {
        name: "astromatch-existing-csv",
        configureServer: function (server) {
            server.middlewares.use("/data", serveCsv);
        },
        configurePreviewServer: function (server) {
            server.middlewares.use("/data", serveCsv);
        },
    };
}
export default defineConfig({
    plugins: [react(), existingCsvPlugin()],
});
