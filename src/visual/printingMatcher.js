import { fetch } from "undici";
import sharp from "sharp";
const DEFAULT_HASH_SIZE = 16;
const TITLE_HASH_SIZE = 24;
const HISTOGRAM_BINS_PER_CHANNEL = 4;
const ART_REGION = {
    height: 0.37,
    width: 0.84,
    x: 0.08,
    y: 0.12,
};
const TITLE_REGION = {
    height: 0.12,
    width: 0.9,
    x: 0.05,
    y: 0.02,
};
const remoteFingerprintCache = new Map();
function clamp01(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.min(1, Math.max(0, value));
}
function normalizeCrop(crop) {
    if (!crop)
        return null;
    const x = clamp01(Number(crop.x));
    const y = clamp01(Number(crop.y));
    const width = clamp01(Number(crop.width));
    const height = clamp01(Number(crop.height));
    if (width <= 0 || height <= 0)
        return null;
    return {
        height: Math.min(height, 1 - y),
        width: Math.min(width, 1 - x),
        x,
        y,
    };
}
async function ensureRgbImage(buffer) {
    return sharp(buffer).rotate().removeAlpha();
}
function normalizedRegionToPixels(width, height, region) {
    const left = Math.max(0, Math.round(region.x * width));
    const top = Math.max(0, Math.round(region.y * height));
    const extractWidth = Math.max(1, Math.min(width - left, Math.round(region.width * width)));
    const extractHeight = Math.max(1, Math.min(height - top, Math.round(region.height * height)));
    return { height: extractHeight, left, top, width: extractWidth };
}
async function extractRegion(buffer, region) {
    const image = await ensureRgbImage(buffer);
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width <= 0 || height <= 0) {
        throw new Error("Unable to determine image dimensions for crop.");
    }
    return image
        .extract(normalizedRegionToPixels(width, height, region))
        .jpeg()
        .toBuffer();
}
function averageSeries(values, start, end) {
    const safeStart = Math.max(0, start);
    const safeEnd = Math.min(values.length, end);
    if (safeEnd <= safeStart) {
        return 0;
    }
    let total = 0;
    for (let index = safeStart; index < safeEnd; index += 1) {
        total += values[index] ?? 0;
    }
    return total / (safeEnd - safeStart);
}
function findStrongEdge(values, startRatio, endRatio, fromEnd = false) {
    const start = Math.max(1, Math.floor(values.length * startRatio));
    const end = Math.max(start + 1, Math.floor(values.length * endRatio));
    let bestIndex = start;
    let bestScore = -1;
    for (let index = start; index < end; index += 1) {
        const smoothed = averageSeries(values, index - 2, index + 3);
        if (smoothed > bestScore) {
            bestScore = smoothed;
            bestIndex = index;
        }
    }
    return fromEnd ? Math.min(values.length - 1, bestIndex + 1) : bestIndex;
}
async function tightenCardBounds(buffer) {
    const baseImage = sharp(buffer).rotate().removeAlpha();
    const baseMetadata = await baseImage.metadata();
    const baseWidth = baseMetadata.width ?? 0;
    const baseHeight = baseMetadata.height ?? 0;
    if (baseWidth <= 0 || baseHeight <= 0) {
        return buffer;
    }
    const analysisWidth = 240;
    const analysisHeight = 336;
    const { data, info } = await baseImage
        .clone()
        .greyscale()
        .resize(analysisWidth, analysisHeight, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const rowEdges = new Array(info.height).fill(0);
    const colEdges = new Array(info.width).fill(0);
    for (let y = 1; y < info.height; y += 1) {
        let rowScore = 0;
        for (let x = 0; x < info.width; x += 1) {
            rowScore += Math.abs(data[y * info.width + x] - data[(y - 1) * info.width + x]);
        }
        rowEdges[y] = rowScore / info.width;
    }
    for (let x = 1; x < info.width; x += 1) {
        let colScore = 0;
        for (let y = 0; y < info.height; y += 1) {
            colScore += Math.abs(data[y * info.width + x] - data[y * info.width + x - 1]);
        }
        colEdges[x] = colScore / info.height;
    }
    const top = findStrongEdge(rowEdges, 0.04, 0.3);
    const bottom = findStrongEdge(rowEdges, 0.7, 0.98, true);
    const left = findStrongEdge(colEdges, 0.04, 0.3);
    const right = findStrongEdge(colEdges, 0.7, 0.98, true);
    const cropWidth = Math.max(1, right - left);
    const cropHeight = Math.max(1, bottom - top);
    const aspectRatio = cropWidth / cropHeight;
    const coverage = (cropWidth * cropHeight) / (info.width * info.height);
    const edgeStrength = (averageSeries(rowEdges, Math.max(0, top - 1), top + 2) +
        averageSeries(rowEdges, Math.max(0, bottom - 2), bottom + 1) +
        averageSeries(colEdges, Math.max(0, left - 1), left + 2) +
        averageSeries(colEdges, Math.max(0, right - 2), right + 1)) /
        4;
    const looksReasonable = coverage >= 0.45 &&
        coverage <= 0.98 &&
        aspectRatio >= 0.62 &&
        aspectRatio <= 0.78 &&
        edgeStrength >= 8;
    if (!looksReasonable) {
        return buffer;
    }
    return baseImage
        .clone()
        .extract(normalizedRegionToPixels(baseWidth, baseHeight, {
        height: cropHeight / info.height,
        width: cropWidth / info.width,
        x: left / info.width,
        y: top / info.height,
    }))
        .jpeg()
        .toBuffer();
}
async function buildNormalizedScannerImage(sourceBuffer, crop) {
    const initialCrop = normalizeCrop(crop)
        ? await extractRegion(sourceBuffer, normalizeCrop(crop))
        : await sharp(sourceBuffer).rotate().jpeg().toBuffer();
    const tightened = await tightenCardBounds(initialCrop);
    return sharp(tightened)
        .rotate()
        .resize(488, 680, { fit: "fill" })
        .jpeg()
        .toBuffer();
}
async function computeDHash(buffer, size = DEFAULT_HASH_SIZE) {
    const { data, info } = await sharp(buffer)
        .rotate()
        .greyscale()
        .resize(size + 1, size, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const bits = [];
    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width - 1; x++) {
            const leftPixel = data[y * info.width + x];
            const rightPixel = data[y * info.width + x + 1];
            bits.push(leftPixel > rightPixel ? "1" : "0");
        }
    }
    let hash = "";
    for (let index = 0; index < bits.length; index += 4) {
        hash += Number.parseInt(bits.slice(index, index + 4).join(""), 2).toString(16);
    }
    return hash;
}
async function computeTitleHash(buffer) {
    const { data, info } = await sharp(buffer)
        .rotate()
        .greyscale()
        .normalize()
        .sharpen()
        .resize(TITLE_HASH_SIZE + 1, TITLE_HASH_SIZE, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const bits = [];
    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width - 1; x++) {
            const leftPixel = data[y * info.width + x];
            const rightPixel = data[y * info.width + x + 1];
            bits.push(leftPixel > rightPixel ? "1" : "0");
        }
    }
    let hash = "";
    for (let index = 0; index < bits.length; index += 4) {
        hash += Number.parseInt(bits.slice(index, index + 4).join(""), 2).toString(16);
    }
    return hash;
}
async function computeHistogram(buffer) {
    const bins = HISTOGRAM_BINS_PER_CHANNEL;
    const histogram = new Array(bins * bins * bins).fill(0);
    const { data } = await sharp(buffer)
        .rotate()
        .resize(48, 48, { fit: "cover" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    for (let index = 0; index < data.length; index += 3) {
        const r = Math.min(bins - 1, Math.floor((data[index] / 256) * bins));
        const g = Math.min(bins - 1, Math.floor((data[index + 1] / 256) * bins));
        const b = Math.min(bins - 1, Math.floor((data[index + 2] / 256) * bins));
        const bucket = r * bins * bins + g * bins + b;
        histogram[bucket] += 1;
    }
    const total = histogram.reduce((sum, bucket) => sum + bucket, 0) || 1;
    return histogram.map((bucket) => bucket / total);
}
function hammingDistance(left, right) {
    const maxLength = Math.max(left.length, right.length);
    let distance = 0;
    for (let index = 0; index < maxLength; index++) {
        const leftNibble = Number.parseInt(left[index] ?? "0", 16);
        const rightNibble = Number.parseInt(right[index] ?? "0", 16);
        distance += ((leftNibble ^ rightNibble).toString(2).match(/1/g) || [])
            .length;
    }
    return distance;
}
function histogramDistance(left, right) {
    const maxLength = Math.max(left.length, right.length);
    let sum = 0;
    for (let index = 0; index < maxLength; index++) {
        sum += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
    }
    return sum / 2;
}
export function scoreFingerprints(source, candidate) {
    const maxHashBits = DEFAULT_HASH_SIZE * DEFAULT_HASH_SIZE;
    const fullHashDistance = hammingDistance(source.fullHash, candidate.fullHash);
    const artHashDistance = hammingDistance(source.artHash, candidate.artHash);
    const titleHashDistance = hammingDistance(source.titleHash, candidate.titleHash);
    const colorDistance = histogramDistance(source.histogram, candidate.histogram);
    const normalizedFull = fullHashDistance / maxHashBits;
    const normalizedArt = artHashDistance / maxHashBits;
    const normalizedTitle = titleHashDistance / maxHashBits;
    // Dynamic weighting: when art matches very closely, prioritize it heavily
    // This helps alternate arts beat default printings when the captured card matches them
    const artWeight = normalizedArt < 0.05 ? 0.55 : normalizedArt < 0.15 ? 0.45 : 0.35;
    const fullWeight = normalizedArt < 0.05 ? 0.3 : normalizedArt < 0.15 ? 0.4 : 0.5;
    const colorWeight = 1.0 - artWeight - fullWeight;
    const weightedDistance = normalizedFull * fullWeight +
        normalizedArt * artWeight +
        colorDistance * colorWeight;
    const ambiguousVisuals = normalizedArt >= 0.08 || colorDistance >= 0.35;
    let titleWeight = 0;
    if (normalizedArt >= 0.05) {
        if (normalizedTitle < 0.25 && ambiguousVisuals) {
            titleWeight = 0.2;
        }
        else {
            titleWeight = normalizedArt < 0.15 ? 0.14 : 0.1;
        }
    }
    const weightedWithTitle = titleWeight > 0
        ? weightedDistance * (1 - titleWeight) + normalizedTitle * titleWeight
        : weightedDistance;
    // Apply confidence boost for near-perfect art matches (likely exact printing match)
    // This gives alternate arts an edge when they're the actual scanned card
    let confidence = Math.max(0, Math.min(1, 1 - weightedWithTitle));
    if (normalizedArt < 0.03 && colorDistance < 0.1) {
        // Very close art match + similar colors = likely exact printing
        confidence = Math.min(1, confidence * 1.1); // 10% confidence boost
    }
    return {
        artHashDistance,
        colorDistance,
        confidence,
        distance: weightedWithTitle,
        fullHashDistance,
    };
}
export async function buildFingerprintFromBuffer(sourceBuffer, crop) {
    const normalizedSource = await buildNormalizedScannerImage(sourceBuffer, crop);
    const artSource = await extractRegion(normalizedSource, ART_REGION);
    const titleSource = await extractRegion(normalizedSource, TITLE_REGION);
    return {
        artHash: await computeDHash(artSource),
        fullHash: await computeDHash(normalizedSource),
        histogram: await computeHistogram(normalizedSource),
        titleHash: await computeTitleHash(titleSource),
    };
}
async function fetchRemoteBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch remote image: ${response.status} ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
}
export async function buildFingerprintFromRemoteImages(fullImageUrl, artImageUrl) {
    if (!fullImageUrl && !artImageUrl) {
        return null;
    }
    const cacheKey = `${fullImageUrl ?? ""}|${artImageUrl ?? ""}`;
    const cached = remoteFingerprintCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const promise = (async () => {
        try {
            const fullBuffer = fullImageUrl
                ? await fetchRemoteBuffer(fullImageUrl)
                : artImageUrl
                    ? await fetchRemoteBuffer(artImageUrl)
                    : null;
            if (!fullBuffer)
                return null;
            const normalizedFull = await sharp(fullBuffer)
                .rotate()
                .removeAlpha()
                .resize(488, 680, { fit: "fill" })
                .jpeg()
                .toBuffer();
            const artBuffer = artImageUrl
                ? await fetchRemoteBuffer(artImageUrl)
                : await extractRegion(normalizedFull, ART_REGION);
            const titleBuffer = await extractRegion(normalizedFull, TITLE_REGION);
            return {
                artHash: await computeDHash(artBuffer),
                fullHash: await computeDHash(normalizedFull),
                histogram: await computeHistogram(normalizedFull),
                titleHash: await computeTitleHash(titleBuffer),
            };
        }
        catch (error) {
            console.warn("⚠️ Failed to compute remote fingerprint:", cacheKey, error);
            return null;
        }
    })();
    remoteFingerprintCache.set(cacheKey, promise);
    return promise;
}
export async function rankCandidatePrintings(sourceBuffer, candidates, crop) {
    const sourceFingerprint = await buildFingerprintFromBuffer(sourceBuffer, crop);
    const ranked = [];
    for (const candidate of candidates) {
        const candidateFingerprint = await buildFingerprintFromRemoteImages(candidate.fullImageUrl, candidate.artImageUrl);
        if (!candidateFingerprint)
            continue;
        ranked.push({
            ...scoreFingerprints(sourceFingerprint, candidateFingerprint),
            card: candidate.card,
        });
    }
    return ranked.sort((left, right) => right.confidence - left.confidence);
}
