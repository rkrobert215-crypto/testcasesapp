const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const TARGET_BYTES = 500_000;
const MAX_OUTPUT_BYTES = 600_000;
const MAX_COMBINED_DATA_URL_CHARACTERS = 3_800_000;
const MAX_DIMENSION = 1800;
const MIN_DIMENSION = 480;
const OUTPUT_TYPE = 'image/jpeg';
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export interface OptimizedImage {
  dataUrl: string;
  originalBytes: number;
  optimizedBytes: number;
}

export function fitImagesWithinCloudPayloadBudget(
  existingDataUrls: string[],
  candidateDataUrls: string[]
) {
  const accepted: string[] = [];
  let totalCharacters = existingDataUrls.reduce((total, dataUrl) => total + dataUrl.length, 0);

  for (const dataUrl of candidateDataUrls) {
    if (totalCharacters + dataUrl.length > MAX_COMBINED_DATA_URL_CHARACTERS) {
      continue;
    }
    accepted.push(dataUrl);
    totalCharacters += dataUrl.length;
  }

  return {
    accepted,
    rejectedCount: candidateDataUrls.length - accepted.length,
  };
}

export async function optimizeImageForAi(file: File): Promise<OptimizedImage> {
  if (!ALLOWED_TYPES.has(file.type.toLowerCase())) {
    throw new Error(`${file.name} must be a PNG, JPEG, WebP, or GIF image.`);
  }
  if (file.size === 0) {
    throw new Error(`${file.name} is empty.`);
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(`${file.name} is larger than the 15 MB upload limit.`);
  }

  const image = await loadImage(file);
  let { width, height } = fitWithin(image.width, image.height, MAX_DIMENSION);
  let blob: Blob | null = null;

  for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      image.close();
      throw new Error('This browser could not prepare the screenshot for upload.');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image.source, 0, 0, width, height);

    for (const quality of [0.88, 0.78, 0.68, 0.58, 0.5]) {
      blob = await canvasToBlob(canvas, OUTPUT_TYPE, quality);
      if (blob.size <= TARGET_BYTES) {
        break;
      }
    }

    if (blob && blob.size <= MAX_OUTPUT_BYTES) {
      break;
    }

    const scale = blob
      ? Math.min(0.82, Math.sqrt(TARGET_BYTES / blob.size) * 0.94)
      : 0.75;
    width = Math.max(MIN_DIMENSION, Math.round(width * scale));
    height = Math.max(MIN_DIMENSION, Math.round(height * scale));
  }

  image.close();

  if (!blob || blob.size > MAX_OUTPUT_BYTES) {
    throw new Error(`${file.name} could not be reduced below the cloud screenshot limit.`);
  }

  return {
    dataUrl: await blobToDataUrl(blob),
    originalBytes: file.size,
    optimizedBytes: blob.size,
  };
}

async function loadImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`${file.name} could not be decoded as an image.`));
      image.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function fitWithin(width: number, height: number, maximum: number) {
  const scale = Math.min(1, maximum / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Screenshot compression failed.'))),
      type,
      quality
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Screenshot encoding failed.'));
    reader.onerror = () => reject(new Error('Screenshot encoding failed.'));
    reader.readAsDataURL(blob);
  });
}
