import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import exifr from 'exifr';
import { ArrowRight, CalendarDays, Camera, ChevronLeft, ChevronRight, Images, LoaderCircle, Pencil, Ruler, Scan, Sparkles, Trash2, X } from 'lucide-react';
import type { ProgressCategory, ProgressPhoto, ProgressSideAlignment, ProgressSymmetry } from '../types';

const preloadedViewerImages = new Map<string, HTMLImageElement>();
type MeasurementLayer = 'shoulders' | 'midline' | 'torso' | 'jaw' | 'side-chain' | 'plumb';
type MeasurementPoint = { x: number; y: number };
type FrontPointKey = 'imageLeftShoulder' | 'imageRightShoulder' | 'imageLeftHip' | 'imageRightHip' | 'imageLeftEar' | 'imageRightEar' | 'chin' | 'headCenter';
type SidePointKey = 'ear' | 'shoulder' | 'hip' | 'knee' | 'ankle';
type MeasurementDrag =
  | { kind: 'front-point'; photoId: string; pointerId: number; key: FrontPointKey }
  | { kind: 'side-point'; photoId: string; pointerId: number; key: SidePointKey }
  | { kind: 'body-line-end'; photoId: string; pointerId: number; end: 'start' | 'end' }
  | { kind: 'body-line'; photoId: string; pointerId: number; pointerStart: MeasurementPoint; lineStart: NonNullable<ProgressSymmetry['manualBodyLine']> };

function preloadViewerImage(url: string) {
  if (preloadedViewerImages.has(url)) return;
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  preloadedViewerImages.set(url, image);
  void image.decode().catch(() => {
    // Loading errors are still handled by the visible image element.
  });
}

const categories: Array<{ id: ProgressCategory; short: string; label: string; hint: string }> = [
  { id: 'front-relaxed', short: 'Relaxed', label: 'Front · relaxed', hint: 'Facing forward, arms down' },
  { id: 'front-open', short: 'Arms open', label: 'Front · arms open', hint: 'Facing forward, arms extended' },
  { id: 'side', short: 'Side', label: 'Side profile', hint: 'Left or right side view' },
];

function localDateValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(value + 'T12:00:00'));
}

function dateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})[:-](\d{2})[:-](\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return null;
}

async function getPhotoDate(file: File) {
  try {
    const metadata = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized']) as Record<string, unknown> | undefined;
    for (const field of ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized']) {
      const value = dateValue(metadata?.[field]);
      if (value && value <= localDateValue()) return value;
    }
  } catch {
    // Photos without readable metadata use the manually selected fallback date.
  }
  return null;
}

function getBodyLine(symmetry: ProgressSymmetry) {
  const left = symmetry.imageLeftShoulder;
  const right = symmetry.imageRightShoulder;
  const leftHip = symmetry.imageLeftHip!;
  const rightHip = symmetry.imageRightHip!;
  const shoulderMidY = (left.y + right.y) / 2;
  const shoulderMidX = (left.x + right.x) / 2;
  const hipMidX = (leftHip.x + rightHip.x) / 2;
  const hipMidY = (leftHip.y + rightHip.y) / 2;
  const centerXAt = (y: number) => shoulderMidX
    + (hipMidX - shoulderMidX) * ((y - shoulderMidY) / (hipMidY - shoulderMidY));
  const bodyLineTop = Math.max(0.02, symmetry.headCenter.y - 0.14);
  const bodyLineBottom = Math.min(0.98, hipMidY + 0.14);
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return symmetry.manualBodyLine || {
    start: { x: clamp(centerXAt(bodyLineTop)), y: bodyLineTop },
    end: { x: clamp(centerXAt(bodyLineBottom)), y: bodyLineBottom },
  };
}

function getSymmetryMetrics(symmetry: ProgressSymmetry, imageWidth: number, imageHeight: number) {
  const left = symmetry.imageLeftShoulder;
  const right = symmetry.imageRightShoulder;
  const shoulderAngle = Math.atan2(
    Math.abs((right.y - left.y) * imageHeight),
    Math.abs((right.x - left.x) * imageWidth),
  ) * 180 / Math.PI;
  const shoulderHeightPercent = Math.abs(right.y - left.y) * 100;
  const shoulderMidY = (left.y + right.y) / 2;
  const bodyLine = getBodyLine(symmetry);
  const bodyLineDy = bodyLine.end.y - bodyLine.start.y;
  const bodyLineXAt = (y: number) => Math.abs(bodyLineDy) < 0.001
    ? (bodyLine.start.x + bodyLine.end.x) / 2
    : bodyLine.start.x + (bodyLine.end.x - bodyLine.start.x) * ((y - bodyLine.start.y) / bodyLineDy);
  const headOffset = symmetry.headCenter.x - bodyLineXAt(symmetry.headCenter.y);
  const headOffsetShoulderPercent = Math.abs(headOffset) / (right.x - left.x) * 100;
  const pointDistance = (first: { x: number; y: number }, second: { x: number; y: number }) => Math.hypot(
    (first.x - second.x) * imageWidth,
    (first.y - second.y) * imageHeight,
  );
  const jaw = symmetry.imageLeftEar && symmetry.imageRightEar && symmetry.chin
    ? (() => {
      const leftJawLength = pointDistance(symmetry.imageLeftEar!, symmetry.chin!);
      const rightJawLength = pointDistance(symmetry.imageRightEar!, symmetry.chin!);
      const earSpan = Math.max(1, pointDistance(symmetry.imageLeftEar!, symmetry.imageRightEar!));
      return {
        leftLengthPercent: leftJawLength / earSpan * 100,
        rightLengthPercent: rightJawLength / earSpan * 100,
        differencePercent: Math.abs(leftJawLength - rightJawLength) / ((leftJawLength + rightJawLength) / 2) * 100,
        longerSide: leftJawLength > rightJawLength ? 'Image-left' : rightJawLength > leftJawLength ? 'Image-right' : '',
      };
    })()
    : null;

  return {
    shoulderAngle,
    shoulderHeightPercent,
    shoulderMidY,
    higherShoulder: left.y < right.y ? 'Image-left' : right.y < left.y ? 'Image-right' : '',
    headOffsetShoulderPercent,
    headDirection: headOffset > 0 ? 'right' : headOffset < 0 ? 'left' : '',
    jaw,
    bodyLine,
  };
}

function getSideAlignmentMetrics(alignment: ProgressSideAlignment, imageWidth: number, imageHeight: number) {
  const lowerLegDx = (alignment.knee.x - alignment.ankle.x) * imageWidth;
  const lowerLegDy = (alignment.ankle.y - alignment.knee.y) * imageHeight;
  const tibialAngle = Math.atan2(Math.abs(lowerLegDx), Math.abs(lowerLegDy)) * 180 / Math.PI;
  const facingSign = alignment.facing === 'image-right' ? 1 : -1;
  const tibialDirection = lowerLegDx * facingSign > 0 ? 'anterior' : lowerLegDx * facingSign < 0 ? 'posterior' : 'neutral';
  const headDx = (alignment.ear.x - alignment.shoulder.x) * imageWidth;
  const torsoHeight = Math.max(1, (alignment.hip.y - alignment.shoulder.y) * imageHeight);
  const headOffsetPercent = Math.abs(headDx) / torsoHeight * 100;
  const headDirection = headDx * facingSign > 0 ? 'forward' : headDx * facingSign < 0 ? 'back' : 'centered';
  return { tibialAngle, tibialDirection, headOffsetPercent, headDirection };
}

export function ProgressPage({ notify }: { notify: (message: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);
  const [category, setCategory] = useState<ProgressCategory>('front-relaxed');
  const [capturedAt, setCapturedAt] = useState(localDateValue);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState('');
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);
  const viewerStageRef = useRef<HTMLDivElement>(null);
  const viewerImageRef = useRef<HTMLImageElement>(null);
  const [viewerOverlay, setViewerOverlay] = useState<{ top: number; side: number } | null>(null);
  const [viewerImageStyle, setViewerImageStyle] = useState<CSSProperties | null>(null);
  const [viewerMediaStyle, setViewerMediaStyle] = useState<CSSProperties | null>(null);
  const [viewerNaturalSize, setViewerNaturalSize] = useState({ width: 0, height: 0 });
  const [positionedPhotoId, setPositionedPhotoId] = useState<string | null>(null);
  const [alignViewer, setAlignViewer] = useState(() => window.localStorage.getItem('progress-align-viewer') !== 'off');
  const [symmetryEnabled, setSymmetryEnabled] = useState(false);
  const [measurementLayers, setMeasurementLayers] = useState<Record<MeasurementLayer, boolean>>({
    shoulders: true,
    midline: true,
    torso: true,
    jaw: true,
    'side-chain': true,
    plumb: true,
  });
  const [measuringSymmetryId, setMeasuringSymmetryId] = useState<string | null>(null);
  const [symmetryError, setSymmetryError] = useState<{ photoId: string; message: string } | null>(null);
  const [editingMeasurements, setEditingMeasurements] = useState(false);
  const [savingMeasurementsId, setSavingMeasurementsId] = useState<string | null>(null);
  const photosRef = useRef<ProgressPhoto[]>([]);
  const measurementDrag = useRef<MeasurementDrag | null>(null);
  const measurementSaveTimer = useRef<number | null>(null);
  const measurementSaveRevision = useRef(0);

  const loadPhotos = async () => {
    try {
      const response = await fetch('/api/progress', { cache: 'no-store' });
      const payload = await response.json() as { photos?: ProgressPhoto[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not load progress photos.');
      setPhotos(payload.photos || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load progress photos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadPhotos(); }, []);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => {
    setEditingMeasurements(false);
    measurementDrag.current = null;
  }, [activePhotoId]);
  useEffect(() => () => {
    if (measurementSaveTimer.current !== null) window.clearTimeout(measurementSaveTimer.current);
  }, []);

  const visible = useMemo(() => photos
    .filter((photo) => photo.category === category)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.uploadedAt.localeCompare(a.uploadedAt)), [photos, category]);

  const activePhotoIndex = visible.findIndex((photo) => photo.id === activePhotoId);
  const activePhoto = activePhotoIndex >= 0 ? visible[activePhotoIndex] : null;
  const hasFrontMeasurement = Boolean(
    activePhoto?.symmetry?.measurementVersion === 2
    && activePhoto.symmetry.imageLeftHip
    && activePhoto.symmetry.imageRightHip,
  );
  const hasActiveMeasurement = activePhoto?.category === 'side' ? Boolean(activePhoto.sideAlignment) : hasFrontMeasurement;
  const symmetryMetrics = activePhoto?.symmetry && hasFrontMeasurement && viewerNaturalSize.width && viewerNaturalSize.height
    ? getSymmetryMetrics(activePhoto.symmetry, viewerNaturalSize.width, viewerNaturalSize.height)
    : null;
  const sideAlignmentMetrics = activePhoto?.sideAlignment && viewerNaturalSize.width && viewerNaturalSize.height
    ? getSideAlignmentMetrics(activePhoto.sideAlignment, viewerNaturalSize.width, viewerNaturalSize.height)
    : null;
  const suppressViewerClick = useRef(false);

  const showOlderPhoto = () => {
    const nextPhoto = visible[activePhotoIndex + 1];
    if (nextPhoto) setActivePhotoId(nextPhoto.id);
  };

  const showNewerPhoto = () => {
    const nextPhoto = visible[activePhotoIndex - 1];
    if (nextPhoto) setActivePhotoId(nextPhoto.id);
  };

  const toggleMeasurementLayer = (layer: MeasurementLayer) => {
    setMeasurementLayers((current) => ({ ...current, [layer]: !current[layer] }));
  };

  const replacePhotoMeasurement = (photoId: string, update: (photo: ProgressPhoto) => ProgressPhoto) => {
    const next = photosRef.current.map((photo) => photo.id === photoId ? update(photo) : photo);
    photosRef.current = next;
    setPhotos(next);
  };

  const persistMeasurements = async (photoId: string, revision: number) => {
    const photo = photosRef.current.find((item) => item.id === photoId);
    if (!photo) return;
    setSavingMeasurementsId(photoId);
    setSymmetryError(null);
    try {
      const response = await fetch('/api/progress/' + photoId + '/measurements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(photo.category === 'side'
          ? { sideAlignment: photo.sideAlignment }
          : { symmetry: photo.symmetry }),
      });
      const updated = await response.json() as ProgressPhoto & { error?: string };
      if (!response.ok) throw new Error(updated.error || 'Could not save the measurement adjustment.');
      if (revision === measurementSaveRevision.current) {
        replacePhotoMeasurement(photoId, () => updated);
      }
    } catch (saveError) {
      setSymmetryError({
        photoId,
        message: saveError instanceof Error ? saveError.message : 'Could not save the measurement adjustment.',
      });
    } finally {
      if (revision === measurementSaveRevision.current) setSavingMeasurementsId(null);
    }
  };

  const scheduleMeasurementSave = (photoId: string) => {
    if (measurementSaveTimer.current !== null) window.clearTimeout(measurementSaveTimer.current);
    const revision = ++measurementSaveRevision.current;
    measurementSaveTimer.current = window.setTimeout(() => {
      measurementSaveTimer.current = null;
      void persistMeasurements(photoId, revision);
    }, 250);
  };

  const pointerPosition = (event: ReactPointerEvent<SVGElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return null;
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  };

  const beginMeasurementDrag = (event: ReactPointerEvent<SVGElement>, drag: MeasurementDrag) => {
    event.preventDefault();
    event.stopPropagation();
    suppressViewerClick.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    measurementDrag.current = drag;
  };

  const beginFrontPointDrag = (event: ReactPointerEvent<SVGElement>, photoId: string, key: FrontPointKey) => {
    beginMeasurementDrag(event, { kind: 'front-point', photoId, pointerId: event.pointerId, key });
  };

  const beginSidePointDrag = (event: ReactPointerEvent<SVGElement>, photoId: string, key: SidePointKey) => {
    beginMeasurementDrag(event, { kind: 'side-point', photoId, pointerId: event.pointerId, key });
  };

  const beginBodyLineEndDrag = (event: ReactPointerEvent<SVGElement>, photoId: string, end: 'start' | 'end') => {
    const photo = photosRef.current.find((item) => item.id === photoId);
    if (!photo?.symmetry) return;
    if (!photo.symmetry.manualBodyLine) {
      const manualBodyLine = getBodyLine(photo.symmetry);
      replacePhotoMeasurement(photoId, (item) => ({ ...item, symmetry: { ...item.symmetry!, manualBodyLine } }));
    }
    beginMeasurementDrag(event, { kind: 'body-line-end', photoId, pointerId: event.pointerId, end });
  };

  const beginBodyLineDrag = (event: ReactPointerEvent<SVGElement>, photoId: string) => {
    const photo = photosRef.current.find((item) => item.id === photoId);
    const pointerStart = pointerPosition(event);
    if (!photo?.symmetry || !pointerStart) return;
    const lineStart = getBodyLine(photo.symmetry);
    if (!photo.symmetry.manualBodyLine) {
      replacePhotoMeasurement(photoId, (item) => ({ ...item, symmetry: { ...item.symmetry!, manualBodyLine: lineStart } }));
    }
    beginMeasurementDrag(event, { kind: 'body-line', photoId, pointerId: event.pointerId, pointerStart, lineStart });
  };

  const moveMeasurementDrag = (event: ReactPointerEvent<SVGElement>) => {
    const drag = measurementDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointerPosition(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();

    if (drag.kind === 'front-point') {
      replacePhotoMeasurement(drag.photoId, (photo) => ({
        ...photo,
        symmetry: { ...photo.symmetry!, [drag.key]: point },
      }));
      return;
    }
    if (drag.kind === 'side-point') {
      replacePhotoMeasurement(drag.photoId, (photo) => ({
        ...photo,
        sideAlignment: { ...photo.sideAlignment!, [drag.key]: point },
      }));
      return;
    }
    if (drag.kind === 'body-line-end') {
      replacePhotoMeasurement(drag.photoId, (photo) => {
        const line = photo.symmetry!.manualBodyLine || getBodyLine(photo.symmetry!);
        return { ...photo, symmetry: { ...photo.symmetry!, manualBodyLine: { ...line, [drag.end]: point } } };
      });
      return;
    }

    const rawDx = point.x - drag.pointerStart.x;
    const rawDy = point.y - drag.pointerStart.y;
    const dx = Math.max(-Math.min(drag.lineStart.start.x, drag.lineStart.end.x), Math.min(1 - Math.max(drag.lineStart.start.x, drag.lineStart.end.x), rawDx));
    const dy = Math.max(-Math.min(drag.lineStart.start.y, drag.lineStart.end.y), Math.min(1 - Math.max(drag.lineStart.start.y, drag.lineStart.end.y), rawDy));
    replacePhotoMeasurement(drag.photoId, (photo) => ({
      ...photo,
      symmetry: {
        ...photo.symmetry!,
        manualBodyLine: {
          start: { x: drag.lineStart.start.x + dx, y: drag.lineStart.start.y + dy },
          end: { x: drag.lineStart.end.x + dx, y: drag.lineStart.end.y + dy },
        },
      },
    }));
  };

  const finishMeasurementDrag = (event: ReactPointerEvent<SVGElement>) => {
    const drag = measurementDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    measurementDrag.current = null;
    scheduleMeasurementSave(drag.photoId);
    window.setTimeout(() => { suppressViewerClick.current = false; }, 100);
  };

  const positionViewerOverlay = () => {
    const stage = viewerStageRef.current;
    const image = viewerImageRef.current;
    if (!stage || !image?.naturalWidth || !image.naturalHeight) return;
    setViewerNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });

    if (alignViewer && activePhoto?.alignment) {
      const { top, left, bottom, right, headTop, waistCenter, torsoCenterX } = activePhoto.alignment;
      if (headTop && waistCenter && torsoCenterX !== undefined) {
        const referenceHeight = (waistCenter.y - headTop.y) * image.naturalHeight;
        const scale = stage.clientHeight * 0.62 / referenceHeight;
        const imageStyle = {
          width: image.naturalWidth * scale,
          height: image.naturalHeight * scale,
          left: stage.clientWidth / 2 - torsoCenterX * image.naturalWidth * scale,
          top: stage.clientHeight * 0.17 - headTop.y * image.naturalHeight * scale,
        };
        setViewerImageStyle(imageStyle);
        setViewerMediaStyle(imageStyle);
        setViewerOverlay({ top: 10, side: 10 });
        setPositionedPhotoId(activePhoto.id);
        return;
      }

      const personHeight = (bottom - top) * image.naturalHeight;
      const scale = stage.clientHeight * 0.84 / personHeight;
      const personCenterX = (left + right) / 2 * image.naturalWidth;
      const personCenterY = (top + bottom) / 2 * image.naturalHeight;
      const imageStyle = {
        width: image.naturalWidth * scale,
        height: image.naturalHeight * scale,
        left: stage.clientWidth / 2 - personCenterX * scale,
        top: stage.clientHeight / 2 - personCenterY * scale,
      };
      setViewerImageStyle(imageStyle);
      setViewerMediaStyle(imageStyle);
      setViewerOverlay({ top: 10, side: 10 });
      setPositionedPhotoId(activePhoto.id);
      return;
    }

    setViewerImageStyle(null);
    const scale = Math.min(stage.clientWidth / image.naturalWidth, stage.clientHeight / image.naturalHeight);
    const displayedWidth = image.naturalWidth * scale;
    const displayedHeight = image.naturalHeight * scale;
    setViewerMediaStyle({
      width: displayedWidth,
      height: displayedHeight,
      left: (stage.clientWidth - displayedWidth) / 2,
      top: (stage.clientHeight - displayedHeight) / 2,
    });
    setViewerOverlay({
      top: Math.max(10, (stage.clientHeight - displayedHeight) / 2 + 10),
      side: Math.max(10, (stage.clientWidth - displayedWidth) / 2 + 10),
    });
    if (activePhoto) setPositionedPhotoId(activePhoto.id);
  };

  useEffect(() => {
    if (!activePhoto) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActivePhotoId(null);
      if (event.key === 'ArrowLeft') showOlderPhoto();
      if (event.key === 'ArrowRight') showNewerPhoto();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activePhotoIndex, activePhoto, visible]);

  useEffect(() => {
    if (activePhotoIndex < 0) return;
    // Decode both immediate neighbours (and the next pair) before navigation.
    // Keep only this small window warm so long timelines do not retain every photo.
    const warmUrls = new Set<string>();
    for (const offset of [-2, -1, 1, 2]) {
      const photo = visible[activePhotoIndex + offset];
      if (photo) {
        warmUrls.add(photo.url);
        preloadViewerImage(photo.url);
      }
    }
    for (const [url, image] of preloadedViewerImages) {
      if (!warmUrls.has(url)) {
        image.src = '';
        preloadedViewerImages.delete(url);
      }
    }
  }, [activePhotoIndex, visible]);

  useLayoutEffect(() => {
    if (!activePhotoId) {
      setViewerOverlay(null);
      setViewerImageStyle(null);
      setViewerMediaStyle(null);
      setViewerNaturalSize({ width: 0, height: 0 });
      setPositionedPhotoId(null);
      return;
    }
    const stage = viewerStageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(positionViewerOverlay);
    observer.observe(stage);
    window.visualViewport?.addEventListener('resize', positionViewerOverlay);
    positionViewerOverlay();
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener('resize', positionViewerOverlay);
    };
  }, [activePhotoId, alignViewer, activePhoto?.alignment]);

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError('');
    let uploaded = 0;
    for (let index = 0; index < files.length; index += 1) {
      setUploadProgress('Reading photo date ' + (index + 1) + ' of ' + files.length + '…');
      const metadataDate = await getPhotoDate(files[index]);
      setUploadProgress('Sorting photo ' + (index + 1) + ' of ' + files.length + '…');
      const form = new FormData();
      form.append('image', files[index]);
      form.append('capturedAt', metadataDate || capturedAt);
      try {
        const response = await fetch('/api/progress', { method: 'POST', body: form });
        const payload = await response.json() as ProgressPhoto & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Could not upload ' + files[index].name + '.');
        setPhotos((current) => [payload, ...current]);
        setCategory(payload.category);
        uploaded += 1;
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'Could not upload that photo.');
        break;
      }
    }
    setUploading(false);
    setUploadProgress('');
    if (inputRef.current) inputRef.current.value = '';
    if (uploaded) notify(uploaded + ' progress photo' + (uploaded === 1 ? '' : 's') + ' sorted');
  };

  const movePhoto = async (photo: ProgressPhoto, nextCategory: ProgressCategory) => {
    if (photo.category === nextCategory) return;
    try {
      const response = await fetch('/api/progress/' + photo.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: nextCategory }),
      });
      const updated = await response.json() as ProgressPhoto & { error?: string };
      if (!response.ok) throw new Error(updated.error || 'Could not move that photo.');
      setPhotos((current) => current.map((item) => item.id === updated.id ? updated : item));
      notify('Moved to ' + categories.find((item) => item.id === nextCategory)?.label);
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : 'Could not move that photo.');
    }
  };

  const toggleSymmetry = async (photo: ProgressPhoto) => {
    setSymmetryError(null);
    const hasMeasurement = photo.category === 'side'
      ? Boolean(photo.sideAlignment)
      : Boolean(
        photo.symmetry?.measurementVersion === 2
        && photo.symmetry.imageLeftHip
        && photo.symmetry.imageRightHip,
      );
    if (hasMeasurement) {
      setSymmetryEnabled((current) => !current);
      return;
    }
    setMeasuringSymmetryId(photo.id);
    try {
      const response = await fetch('/api/progress/' + photo.id + '/symmetry', { method: 'POST' });
      const updated = await response.json() as ProgressPhoto & { error?: string };
      if (!response.ok) throw new Error(updated.error || 'Could not measure symmetry in this photo.');
      setPhotos((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSymmetryEnabled(true);
    } catch (measureError) {
      setSymmetryError({
        photoId: photo.id,
        message: measureError instanceof Error ? measureError.message : 'Could not measure symmetry in this photo.',
      });
    } finally {
      setMeasuringSymmetryId(null);
    }
  };

  const deletePhoto = async (photo: ProgressPhoto) => {
    if (!window.confirm('Delete this progress photo permanently?')) return;
    try {
      const response = await fetch('/api/progress/' + photo.id, { method: 'DELETE' });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not delete that photo.');
      setPhotos((current) => current.filter((item) => item.id !== photo.id));
      if (activePhotoId === photo.id) setActivePhotoId(null);
      notify('Progress photo deleted');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete that photo.');
    }
  };

  const oldest = visible[visible.length - 1];
  const newest = visible[0];
  const activeMeta = categories.find((item) => item.id === category)!;

  return (
    <main className="page progress-page">
      <header className="simple-header"><div><span className="eyebrow">Visual timeline</span><h1>Progress photos</h1></div><span className="header-icon"><Images size={23} /></span></header>

      <section className="progress-upload-card">
        <div className="progress-upload-icon"><Sparkles size={21} /></div>
        <div className="progress-upload-copy"><h2>AI pose sorter</h2><p>Add one or several photos. Their original dates are read automatically when available, then Gemini sorts each pose.</p></div>
        <label className="progress-date"><CalendarDays size={16} /><span>Fallback date</span><input type="date" value={capturedAt} max={localDateValue()} onChange={(event) => setCapturedAt(event.target.value)} /></label>
        <button className="primary-button progress-upload-button" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <LoaderCircle className="spin" size={18} /> : <Camera size={18} />}
          {uploading ? uploadProgress : 'Choose progress photos'}
        </button>
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={(event) => void uploadFiles(event.target.files)} />
      </section>

      {error && <div className="error-message" role="alert">{error}</div>}

      <div className="pose-tabs" aria-label="Progress photo pose">
        {categories.map((item) => {
          const count = photos.filter((photo) => photo.category === item.id).length;
          return <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}><span>{item.short}</span><small>{count}</small></button>;
        })}
      </div>

      <section className="progress-section-heading">
        <div><h2>{activeMeta.label}</h2><p>{activeMeta.hint}</p></div>
        <span>{visible.length} photo{visible.length === 1 ? '' : 's'}</span>
      </section>

      {visible.length >= 2 && <section className="comparison-card">
        <div className="comparison-heading"><div><span>Then</span><strong>{formatDate(oldest.capturedAt)}</strong></div><ArrowRight size={18} /><div><span>Now</span><strong>{formatDate(newest.capturedAt)}</strong></div></div>
        <div className="comparison-images"><button onClick={() => setActivePhotoId(oldest.id)}><img src={oldest.url} alt={activeMeta.label + ' on ' + formatDate(oldest.capturedAt)} /></button><button onClick={() => setActivePhotoId(newest.id)}><img src={newest.url} alt={activeMeta.label + ' on ' + formatDate(newest.capturedAt)} /></button></div>
      </section>}

      {loading ? <div className="progress-empty"><LoaderCircle className="spin" size={26} /><strong>Loading your timeline…</strong></div> : visible.length ? (
        <section className="progress-grid">
          {visible.map((photo) => <article className="progress-photo" key={photo.id}>
            <button className="progress-photo-open" onClick={() => setActivePhotoId(photo.id)} aria-label={'Open progress photo from ' + formatDate(photo.capturedAt)}><img src={photo.url} alt={activeMeta.label + ' progress photo from ' + formatDate(photo.capturedAt)} /></button>
            <div className="progress-photo-meta"><div><strong>{formatDate(photo.capturedAt)}</strong><span>{photo.confidence} confidence</span></div><button aria-label="Delete photo" onClick={() => void deletePhoto(photo)}><Trash2 size={15} /></button></div>
            <p title={photo.reason}>{photo.reason}</p>
            <label className="move-photo"><span>Folder</span><select value={photo.category} onChange={(event) => void movePhoto(photo, event.target.value as ProgressCategory)}>{categories.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          </article>)}
        </section>
      ) : <div className="progress-empty"><Camera size={27} /><strong>No {activeMeta.short.toLowerCase()} photos yet</strong><span>Add a photo above and the pose sorter will file it here when it matches.</span></div>}

      <p className="progress-privacy">Pose sorting only — the AI is not asked to rate or judge your body.</p>

      {activePhoto && <div
        className="progress-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={'Progress photo from ' + formatDate(activePhoto.capturedAt)}
      >
        <div className="progress-viewer-content">
          <div
            ref={viewerStageRef}
            className={editingMeasurements ? 'progress-viewer-stage is-editing' : 'progress-viewer-stage'}
            onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
            onTouchEnd={(event) => {
              if (touchStartX.current === null) return;
              const distance = event.changedTouches[0].clientX - touchStartX.current;
              if (Math.abs(distance) > 45) {
                suppressViewerClick.current = true;
                if (distance > 0) showOlderPhoto();
                else showNewerPhoto();
                window.setTimeout(() => { suppressViewerClick.current = false; }, 500);
              }
              touchStartX.current = null;
            }}
          >
            <img
              ref={viewerImageRef}
              className={[
                viewerImageStyle ? 'progress-viewer-image-aligned' : '',
                positionedPhotoId === activePhoto.id ? 'progress-viewer-image-ready' : '',
              ].filter(Boolean).join(' ')}
              src={activePhoto.url}
              alt={activeMeta.label + ' progress photo from ' + formatDate(activePhoto.capturedAt)}
              style={viewerImageStyle || undefined}
              decoding="sync"
              fetchPriority="high"
              onLoad={positionViewerOverlay}
            />
            {symmetryEnabled && activePhoto.symmetry && symmetryMetrics && viewerMediaStyle && positionedPhotoId === activePhoto.id && <>
              <svg
                className={editingMeasurements ? 'progress-symmetry-overlay editable' : 'progress-symmetry-overlay'}
                style={viewerMediaStyle}
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {measurementLayers.shoulders && <>
                  <line
                    className="progress-symmetry-level"
                    x1={activePhoto.symmetry.imageLeftShoulder.x * 1000}
                    y1={symmetryMetrics.shoulderMidY * 1000}
                    x2={activePhoto.symmetry.imageRightShoulder.x * 1000}
                    y2={symmetryMetrics.shoulderMidY * 1000}
                  />
                  <line
                    className="progress-symmetry-shoulders"
                    x1={activePhoto.symmetry.imageLeftShoulder.x * 1000}
                    y1={activePhoto.symmetry.imageLeftShoulder.y * 1000}
                    x2={activePhoto.symmetry.imageRightShoulder.x * 1000}
                    y2={activePhoto.symmetry.imageRightShoulder.y * 1000}
                  />
                  <circle className="progress-symmetry-point shoulder progress-measurement-handle" cx={activePhoto.symmetry.imageLeftShoulder.x * 1000} cy={activePhoto.symmetry.imageLeftShoulder.y * 1000} r={editingMeasurements ? 13 : 9} onPointerDown={(event) => beginFrontPointDrag(event, activePhoto.id, 'imageLeftShoulder')} onPointerMove={moveMeasurementDrag} onPointerUp={finishMeasurementDrag} onPointerCancel={finishMeasurementDrag} />
                  <circle className="progress-symmetry-point shoulder progress-measurement-handle" cx={activePhoto.symmetry.imageRightShoulder.x * 1000} cy={activePhoto.symmetry.imageRightShoulder.y * 1000} r={editingMeasurements ? 13 : 9} onPointerDown={(event) => beginFrontPointDrag(event, activePhoto.id, 'imageRightShoulder')} onPointerMove={moveMeasurementDrag} onPointerUp={finishMeasurementDrag} onPointerCancel={finishMeasurementDrag} />
                </>}
                {measurementLayers.midline && <>
                  <line
                    className="progress-symmetry-center"
                    x1={symmetryMetrics.bodyLine.start.x * 1000}
                    y1={symmetryMetrics.bodyLine.start.y * 1000}
                    x2={symmetryMetrics.bodyLine.end.x * 1000}
                    y2={symmetryMetrics.bodyLine.end.y * 1000}
                  />
                  {editingMeasurements && <line
                    className="progress-measurement-line-hit"
                    x1={symmetryMetrics.bodyLine.start.x * 1000}
                    y1={symmetryMetrics.bodyLine.start.y * 1000}
                    x2={symmetryMetrics.bodyLine.end.x * 1000}
                    y2={symmetryMetrics.bodyLine.end.y * 1000}
                    onPointerDown={(event) => beginBodyLineDrag(event, activePhoto.id)}
                    onPointerMove={moveMeasurementDrag}
                    onPointerUp={finishMeasurementDrag}
                    onPointerCancel={finishMeasurementDrag}
                  />}
                  <circle className="progress-symmetry-point head progress-measurement-handle" cx={activePhoto.symmetry.headCenter.x * 1000} cy={activePhoto.symmetry.headCenter.y * 1000} r={editingMeasurements ? 13 : 9} onPointerDown={(event) => beginFrontPointDrag(event, activePhoto.id, 'headCenter')} onPointerMove={moveMeasurementDrag} onPointerUp={finishMeasurementDrag} onPointerCancel={finishMeasurementDrag} />
                  {editingMeasurements && <>
                    <circle className="progress-measurement-line-end" cx={symmetryMetrics.bodyLine.start.x * 1000} cy={symmetryMetrics.bodyLine.start.y * 1000} r="14" onPointerDown={(event) => beginBodyLineEndDrag(event, activePhoto.id, 'start')} onPointerMove={moveMeasurementDrag} onPointerUp={finishMeasurementDrag} onPointerCancel={finishMeasurementDrag} />
                    <circle className="progress-measurement-line-end" cx={symmetryMetrics.bodyLine.end.x * 1000} cy={symmetryMetrics.bodyLine.end.y * 1000} r="14" onPointerDown={(event) => beginBodyLineEndDrag(event, activePhoto.id, 'end')} onPointerMove={moveMeasurementDrag} onPointerUp={finishMeasurementDrag} onPointerCancel={finishMeasurementDrag} />
                  </>}
                </>}
                {measurementLayers.torso && <>
                  <line
                    className="progress-symmetry-torso"
                    x1={activePhoto.symmetry.imageLeftShoulder.x * 1000}
                    y1={activePhoto.symmetry.imageLeftShoulder.y * 1000}
                    x2={activePhoto.symmetry.imageLeftHip!.x * 1000}
                    y2={activePhoto.symmetry.imageLeftHip!.y * 1000}
                  />
                  <line
                    className="progress-symmetry-torso"
                    x1={activePhoto.symmetry.imageRightShoulder.x * 1000}
                    y1={activePhoto.symmetry.imageRightShoulder.y * 1000}
                    x2={activePhoto.symmetry.imageRightHip!.x * 1000}
                    y2={activePhoto.symmetry.imageRightHip!.y * 1000}
                  />
                  <circle className="progress-symmetry-point torso progress-measurement-handle" cx={activePhoto.symmetry.imageLeftHip!.x * 1000} cy={activePhoto.symmetry.imageLeftHip!.y * 1000} r={editingMeasurements ? 13 : 8} onPointerDown={(event) => beginFrontPointDrag(event, activePhoto.id, 'imageLeftHip')} onPointerMove={moveMeasurementDrag} onPointerUp={finishMeasurementDrag} onPointerCancel={finishMeasurementDrag} />
                  <circle className="progress-symmetry-point torso progress-measurement-handle" cx={activePhoto.symmetry.imageRightHip!.x * 1000} cy={activePhoto.symmetry.imageRightHip!.y * 1000} r={editingMeasurements ? 13 : 8} onPointerDown={(event) => beginFrontPointDrag(event, activePhoto.id, 'imageRightHip')} onPointerMove={moveMeasurementDrag} onPointerUp={finishMeasurementDrag} onPointerCancel={finishMeasurementDrag} />
                </>}
                {measurementLayers.jaw && symmetryMetrics.jaw && <>
                  <line
                    className="progress-symmetry-jaw"
                    x1={activePhoto.symmetry.imageLeftEar!.x * 1000}
                    y1={activePhoto.symmetry.imageLeftEar!.y * 1000}
                    x2={activePhoto.symmetry.chin!.x * 1000}
                    y2={activePhoto.symmetry.chin!.y * 1000}
                  />
                  <line
                    className="progress-symmetry-jaw"
                    x1={activePhoto.symmetry.imageRightEar!.x * 1000}
                    y1={activePhoto.symmetry.imageRightEar!.y * 1000}
                    x2={activePhoto.symmetry.chin!.x * 1000}
                    y2={activePhoto.symmetry.chin!.y * 1000}
                  />
                </>}
                {measurementLayers.jaw && symmetryMetrics.jaw && <>
                  <circle className="progress-symmetry-point jaw progress-measurement-handle" cx={activePhoto.symmetry.imageLeftEar!.x * 1000} cy={activePhoto.symmetry.imageLeftEar!.y * 1000} r={editingMeasurements ? 13 : 8} onPointerDown={(event) => beginFrontPointDrag(event, activePhoto.id, 'imageLeftEar')} onPointerMove={moveMeasurementDrag} onPointerUp={finishMeasurementDrag} onPointerCancel={finishMeasurementDrag} />
                  <circle className="progress-symmetry-point jaw progress-measurement-handle" cx={activePhoto.symmetry.imageRightEar!.x * 1000} cy={activePhoto.symmetry.imageRightEar!.y * 1000} r={editingMeasurements ? 13 : 8} onPointerDown={(event) => beginFrontPointDrag(event, activePhoto.id, 'imageRightEar')} onPointerMove={moveMeasurementDrag} onPointerUp={finishMeasurementDrag} onPointerCancel={finishMeasurementDrag} />
                  <circle className="progress-symmetry-point jaw progress-measurement-handle" cx={activePhoto.symmetry.chin!.x * 1000} cy={activePhoto.symmetry.chin!.y * 1000} r={editingMeasurements ? 13 : 8} onPointerDown={(event) => beginFrontPointDrag(event, activePhoto.id, 'chin')} onPointerMove={moveMeasurementDrag} onPointerUp={finishMeasurementDrag} onPointerCancel={finishMeasurementDrag} />
                </>}
              </svg>
              <div className="progress-symmetry-readout" role="status">
                <div><span>Shoulders</span><strong>{symmetryMetrics.shoulderAngle.toFixed(1)}° tilt</strong><small>{symmetryMetrics.shoulderAngle < 0.3 ? 'Visually level' : symmetryMetrics.higherShoulder + ' higher · ' + symmetryMetrics.shoulderHeightPercent.toFixed(1) + '% of image height'}</small></div>
                <div><span>Head</span><strong>{symmetryMetrics.headOffsetShoulderPercent.toFixed(1)}% {symmetryMetrics.headDirection || 'centered'}</strong><small>{symmetryMetrics.headDirection ? 'of shoulder width from body midline' : 'On the body midline'}</small></div>
                {symmetryMetrics.jaw
                  ? <div className="jaw-reading"><span>Chin to ear · relative to ear span</span><strong>Left {symmetryMetrics.jaw.leftLengthPercent.toFixed(1)}% · Right {symmetryMetrics.jaw.rightLengthPercent.toFixed(1)}%</strong><small>{symmetryMetrics.jaw.differencePercent < 0.5 ? 'Lengths visually equal' : symmetryMetrics.jaw.differencePercent.toFixed(1) + '% side-to-side difference · ' + symmetryMetrics.jaw.longerSide + ' longer'}</small></div>
                  : <div className="jaw-reading"><span>Chin to ear</span><strong>Jaw landmarks unavailable</strong><small>Shoulder and centerline measurements are still shown</small></div>}
                <div className="progress-measurement-layers" aria-label="Visible measurement layers">
                  {([
                    ['shoulders', 'shoulder-key', 'Shoulders'],
                    ['torso', 'side-key', 'Torso'],
                    ['midline', 'center-key', 'Midline'],
                    ['jaw', 'jaw-key', 'Chin–ear'],
                  ] as Array<[MeasurementLayer, string, string]>).map(([layer, colorClass, label]) => <button
                    type="button"
                    className={measurementLayers[layer] ? 'active' : ''}
                    onClick={() => toggleMeasurementLayer(layer)}
                    aria-pressed={measurementLayers[layer]}
                    key={layer}
                  ><i className={colorClass} />{label}</button>)}
                  <button type="button" className={editingMeasurements ? 'progress-measurement-edit active' : 'progress-measurement-edit'} onClick={() => setEditingMeasurements((current) => !current)} aria-pressed={editingMeasurements}><Pencil size={11} />{editingMeasurements ? 'Done' : 'Adjust'}</button>
                  <small>{savingMeasurementsId === activePhoto.id ? 'Saving…' : editingMeasurements ? 'Drag dots; drag the blue line to move it' : 'Visual estimate'}</small>
                </div>
              </div>
            </>}
            {symmetryEnabled && activePhoto.sideAlignment && sideAlignmentMetrics && viewerMediaStyle && positionedPhotoId === activePhoto.id && <>
              <svg
                className={editingMeasurements ? 'progress-symmetry-overlay editable' : 'progress-symmetry-overlay'}
                style={viewerMediaStyle}
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {measurementLayers.plumb && <line
                  className="progress-side-plumb"
                  x1={activePhoto.sideAlignment.ankle.x * 1000}
                  y1="35"
                  x2={activePhoto.sideAlignment.ankle.x * 1000}
                  y2="980"
                />}
                {measurementLayers['side-chain'] && <>
                  <polyline
                    className="progress-side-chain"
                    points={[
                      activePhoto.sideAlignment.ear,
                      activePhoto.sideAlignment.shoulder,
                      activePhoto.sideAlignment.hip,
                      activePhoto.sideAlignment.knee,
                      activePhoto.sideAlignment.ankle,
                    ].map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ')}
                  />
                  {([
                    ['ear', activePhoto.sideAlignment.ear],
                    ['shoulder', activePhoto.sideAlignment.shoulder],
                    ['hip', activePhoto.sideAlignment.hip],
                    ['knee', activePhoto.sideAlignment.knee],
                    ['ankle', activePhoto.sideAlignment.ankle],
                  ] as Array<[SidePointKey, MeasurementPoint]>).map(([key, point]) => <circle
                    className="progress-symmetry-point side progress-measurement-handle"
                    cx={point.x * 1000}
                    cy={point.y * 1000}
                    r={editingMeasurements ? 13 : 8}
                    key={key}
                    onPointerDown={(event) => beginSidePointDrag(event, activePhoto.id, key)}
                    onPointerMove={moveMeasurementDrag}
                    onPointerUp={finishMeasurementDrag}
                    onPointerCancel={finishMeasurementDrag}
                  />)}
                </>}
              </svg>
              <div className="progress-symmetry-readout" role="status">
                <div><span>Tibial inclination</span><strong>{sideAlignmentMetrics.tibialAngle.toFixed(1)}° {sideAlignmentMetrics.tibialDirection}</strong><small>Lower leg relative to vertical</small></div>
                <div><span>Head position</span><strong>{sideAlignmentMetrics.headOffsetPercent.toFixed(1)}% {sideAlignmentMetrics.headDirection}</strong><small>Ear relative to shoulder</small></div>
                <div className="progress-measurement-layers" aria-label="Visible measurement layers">
                  <button type="button" className={measurementLayers['side-chain'] ? 'active' : ''} onClick={() => toggleMeasurementLayer('side-chain')} aria-pressed={measurementLayers['side-chain']}><i className="side-key" />Posture chain</button>
                  <button type="button" className={measurementLayers.plumb ? 'active' : ''} onClick={() => toggleMeasurementLayer('plumb')} aria-pressed={measurementLayers.plumb}><i className="plumb-key" />Plumb line</button>
                  <button type="button" className={editingMeasurements ? 'progress-measurement-edit active' : 'progress-measurement-edit'} onClick={() => setEditingMeasurements((current) => !current)} aria-pressed={editingMeasurements}><Pencil size={11} />{editingMeasurements ? 'Done' : 'Adjust'}</button>
                  <small>{savingMeasurementsId === activePhoto.id ? 'Saving…' : editingMeasurements ? 'Drag the dots to adjust the lines' : 'Visual estimate'}</small>
                </div>
              </div>
            </>}
            {symmetryError?.photoId === activePhoto.id && <div className="progress-symmetry-error" role="alert">{symmetryError.message}</div>}
            <div className="progress-viewer-navigation" aria-label="Photo navigation">
              <button
                type="button"
                className="progress-viewer-older"
                disabled={activePhotoIndex >= visible.length - 1}
                onClick={() => {
                  if (!suppressViewerClick.current) showOlderPhoto();
                }}
                aria-label="Show older photo"
                title="Older photo"
              ><ChevronLeft size={28} /><span>Older</span></button>
              <button
                type="button"
                className="progress-viewer-newer"
                disabled={activePhotoIndex <= 0}
                onClick={() => {
                  if (!suppressViewerClick.current) showNewerPhoto();
                }}
                aria-label="Show newer photo"
                title="Newer photo"
              ><span>Newer</span><ChevronRight size={28} /></button>
            </div>
            <div className="progress-viewer-topbar" style={viewerOverlay ? { top: viewerOverlay.top, right: viewerOverlay.side, left: viewerOverlay.side } : undefined}>
              <div className="progress-viewer-tools">
                <button
                  className={alignViewer ? 'progress-viewer-align active' : 'progress-viewer-align'}
                  onClick={() => setAlignViewer((current) => {
                    window.localStorage.setItem('progress-align-viewer', current ? 'off' : 'on');
                    setPositionedPhotoId(null);
                    if (current) setViewerImageStyle(null);
                    return !current;
                  })}
                  disabled={!activePhoto.alignment}
                  aria-label={(alignViewer ? 'Turn off' : 'Turn on') + ' experimental body alignment'}
                  aria-pressed={alignViewer}
                  title={activePhoto.alignment ? 'Body alignment · Experimental' : 'Alignment data unavailable'}
                ><Scan size={20} /></button>
                <button
                  className={symmetryEnabled && hasActiveMeasurement ? 'progress-viewer-symmetry active' : 'progress-viewer-symmetry'}
                  onClick={() => void toggleSymmetry(activePhoto)}
                  disabled={measuringSymmetryId === activePhoto.id}
                  aria-label={hasActiveMeasurement ? (symmetryEnabled ? 'Hide alignment measurement' : 'Show alignment measurement') : 'Measure alignment'}
                  aria-pressed={Boolean(symmetryEnabled && hasActiveMeasurement)}
                  title={hasActiveMeasurement ? 'Toggle alignment measurement' : activePhoto.category === 'side' ? 'Measure sagittal alignment' : 'Measure anterior alignment'}
                >{measuringSymmetryId === activePhoto.id ? <LoaderCircle className="spin" size={19} /> : <Ruler size={19} />}</button>
              </div>
              <time dateTime={activePhoto.capturedAt}>{formatDate(activePhoto.capturedAt)}</time>
              <button className="progress-viewer-close" onClick={() => setActivePhotoId(null)} aria-label="Close full image"><X size={21} /></button>
            </div>
          </div>
        </div>
      </div>}
    </main>
  );
}
