import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Image as ImageIcon, Video, Library, X, Mic2, Check } from "lucide-react";
import { MediaGalleryPicker } from "@/components/MediaGalleryPicker";
import { MediaAsset } from "@/lib/mediaAssets";
import { cn } from "@/lib/utils";

export type GenOptions = {
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  quality: "standard" | "high";
  assets?: MediaAsset[]; // ordered selection from gallery
  // Kling V3 pro image-to-video:
  duration?: string;             // "3"…"15"
  generateAudio?: boolean;
  negativePrompt?: string;
  cfgScale?: number;             // 0–1
  endImageAsset?: MediaAsset | null;
  // Kling V3 pro motion-control (video-to-video):
  referenceImageAsset?: MediaAsset | null;     // appearance source
  characterOrientation?: "image" | "video";
  keepOriginalSound?: boolean;
  elementImageAsset?: MediaAsset | null;       // facial element (orientation="video" only)
  // HeyGen Avatar 4 (audio + image -> video):
  audioAsset?: MediaAsset | null;
  talkingStyle?: "stable" | "expressive";
  resolution?: "360p" | "480p" | "540p" | "720p" | "1080p";
  caption?: boolean;
};

type Props = {
  open: boolean;
  title: string;
  prompt: string;
  mode: "text-image" | "image-image" | "remix" | "image-video" | "video-video" | "audio-image-video" | "analyze-image";
  userId: string;
  onClose: () => void;
  onGenerate: (opts: GenOptions) => Promise<void> | void;
  generateLabel?: string;
};

const KLING_DURATIONS = ["3","4","5","6","7","8","9","10","11","12","13","14","15"] as const;
const DEFAULT_NEGATIVE = "blur, distort, and low quality";

type FilledRowProps = {
  asset: MediaAsset;
  icon: React.ComponentType<{ className?: string }>;
  onClear: () => void;
  onChange: () => void;
};
const FilledRow = ({ asset, icon: Icon, onClear, onChange }: FilledRowProps) => (
  <div className="flex items-center gap-2 text-xs bg-background border rounded-lg p-2">
    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
    <span className="truncate flex-1">{asset.title}</span>
    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onClear}>
      <X className="h-3 w-3" />
    </Button>
    <Button type="button" variant="outline" size="sm" onClick={onChange}>Change</Button>
  </div>
);

export const MediaActionDialog = ({ open, title, prompt, mode, userId, onClose, onGenerate, generateLabel = "Generate" }: Props) => {
  const [aspect, setAspect] = useState<GenOptions["aspectRatio"]>("1:1");
  const [quality, setQuality] = useState<GenOptions["quality"]>("standard");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightField, setHighlightField] = useState<null | "video" | "image" | "audio">(null);

  // Kling V3 pro image-to-video state
  const [duration, setDuration] = useState<string>("5");
  const [generateAudio, setGenerateAudio] = useState<boolean>(true);
  const [negativePrompt, setNegativePrompt] = useState<string>(DEFAULT_NEGATIVE);
  const [cfgScale, setCfgScale] = useState<number>(0.5);
  const [endImage, setEndImage] = useState<MediaAsset | null>(null);
  const [endPickerOpen, setEndPickerOpen] = useState(false);

  // Kling V3 pro motion-control state
  const [referenceImage, setReferenceImage] = useState<MediaAsset | null>(null);
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const [characterOrientation, setCharacterOrientation] = useState<"image" | "video">("image");
  const [keepOriginalSound, setKeepOriginalSound] = useState<boolean>(true);
  const [elementImage, setElementImage] = useState<MediaAsset | null>(null);
  const [elementPickerOpen, setElementPickerOpen] = useState(false);

  // HeyGen Avatar 4 state
  const [audioAsset, setAudioAsset] = useState<MediaAsset | null>(null);
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  const [talkingStyle, setTalkingStyle] = useState<"stable" | "expressive">("stable");
  const [resolution, setResolution] = useState<"360p" | "480p" | "540p" | "720p" | "1080p">("720p");
  const [caption, setCaption] = useState<boolean>(false);

  // Scroll-to-field refs
  const videoRowRef = useRef<HTMLDivElement>(null);
  const imageRowRef = useRef<HTMLDivElement>(null);
  const audioRowRef = useRef<HTMLDivElement>(null);

  // V2V: probed duration for the chosen reference video (seconds).
  const [refVideoDuration, setRefVideoDuration] = useState<number | null>(null);

  // Probe duration of selected V2V reference video so we can warn before submit.
  useEffect(() => {
    if (mode !== "video-video" || assets.length === 0) {
      setRefVideoDuration(null);
      return;
    }
    const a = assets[0];
    if (typeof a.duration_seconds === "number" && a.duration_seconds > 0) {
      setRefVideoDuration(a.duration_seconds);
      return;
    }
    let cancelled = false;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = a.url;
    v.onloadedmetadata = () => {
      if (!cancelled && isFinite(v.duration)) setRefVideoDuration(v.duration);
    };
    v.onerror = () => { if (!cancelled) setRefVideoDuration(null); };
    return () => { cancelled = true; v.removeAttribute("src"); v.load(); };
  }, [mode, assets]);

  const v2vDurationLimit = characterOrientation === "video" ? 30 : 10;
  const v2vDurationOver =
    mode === "video-video" &&
    refVideoDuration !== null &&
    refVideoDuration > v2vDurationLimit + 0.25; // small tolerance for metadata rounding

  useEffect(() => {
    if (open) {
      setAssets([]); setError(null); setHighlightField(null);
      setDuration("5"); setGenerateAudio(true); setNegativePrompt(DEFAULT_NEGATIVE);
      setCfgScale(0.5); setEndImage(null);
      setReferenceImage(null); setCharacterOrientation("image");
      setKeepOriginalSound(true); setElementImage(null);
      setAudioAsset(null); setTalkingStyle("stable"); setResolution("720p"); setCaption(false);
      // HeyGen defaults to 16:9
      if (mode === "audio-image-video") setAspect("16:9");
    }
  }, [open, mode]);

  const isKlingV3Image = mode === "image-video";
  const isKlingMotion = mode === "video-video";
  const isHeyGen = mode === "audio-image-video";
  const needsMedia = mode !== "text-image";
  const needsVideo = mode === "video-video";
  const allowsMultiple = mode === "remix";
  const pickerKind: "image" | "video" = needsVideo ? "video" : "image";
  const pickerMode: "single" | "multi" = allowsMultiple ? "multi" : "single";
  const showAspectAndQuality = mode !== "analyze-image" && !isKlingV3Image && !isKlingMotion && !isHeyGen;
  // The top "Start media" picker is rendered by the generic block for every mode EXCEPT
  // motion-control — V2V draws its own custom Required Inputs block.
  const showGenericTopPicker = needsMedia && !isKlingMotion;

  const focusField = (field: "video" | "image" | "audio") => {
    setHighlightField(field);
    const ref = field === "video" ? videoRowRef : field === "image" ? imageRowRef : audioRowRef;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Clear the highlight after a moment so it acts like a flash, not a permanent state.
    setTimeout(() => setHighlightField((f) => (f === field ? null : f)), 2400);
  };

  const submit = async () => {
    setError(null);
    setHighlightField(null);

    if (isKlingMotion) {
      // V2V: enforce both required uploads with field-pointing errors.
      if (assets.length === 0) {
        setError("Pick a reference video (the motion source).");
        focusField("video");
        return;
      }
      if (!referenceImage) {
        setError("Pick a reference image (the appearance source).");
        focusField("image");
        return;
      }
      if (v2vDurationOver) {
        setError(
          `Reference video is ${refVideoDuration!.toFixed(1)}s — exceeds the ${v2vDurationLimit}s limit for "${characterOrientation === "video" ? "Match reference video" : "Match reference image"}" orientation. ${
            characterOrientation === "image" ? `Switch orientation to "Match reference video" (≤30s) or pick a shorter clip.` : `Pick a shorter clip.`
          }`
        );
        focusField("video");
        return;
      }
    } else if (needsMedia && assets.length === 0) {
      setError(
        isHeyGen ? "Pick a face image from your Media Gallery." :
        "Pick an image from your Media Gallery."
      );
      return;
    }

    if (isHeyGen && !audioAsset) {
      setError("Pick an audio clip from your Media Gallery.");
      focusField("audio");
      return;
    }

    setBusy(true);
    try {
      const opts: GenOptions = {
        aspectRatio: aspect,
        quality,
        assets: assets.length ? assets : undefined,
      };
      if (isKlingV3Image) {
        opts.duration = duration;
        opts.generateAudio = generateAudio;
        opts.negativePrompt = negativePrompt.trim() || DEFAULT_NEGATIVE;
        opts.cfgScale = cfgScale;
        opts.endImageAsset = endImage;
      }
      if (isKlingMotion) {
        opts.referenceImageAsset = referenceImage;
        opts.characterOrientation = characterOrientation;
        opts.keepOriginalSound = keepOriginalSound;
        opts.elementImageAsset = characterOrientation === "video" ? elementImage : null;
      }
      if (isHeyGen) {
        opts.audioAsset = audioAsset;
        opts.talkingStyle = talkingStyle;
        opts.resolution = resolution;
        opts.caption = caption;
      }
      await onGenerate(opts);
    } catch (e: any) {
      setError(e?.message ?? "Failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const KindIcon = pickerKind === "video" ? Video : ImageIcon;

  const StatusChip = ({ filled }: { filled: boolean }) =>
    filled ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded-full">
        <Check className="h-3 w-3" /> Ready
      </span>
    ) : (
      <span className="text-[10px] font-semibold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded-full">
        Required
      </span>
    );

  const NumberBadge = ({ n }: { n: number }) => (
    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-blue-500 text-white text-[10px] font-bold shrink-0">
      {n}
    </span>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-sm max-h-[90vh] p-0 flex flex-col gap-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b">
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            <div>
              <Label>Prompt</Label>
              <p className="text-sm bg-muted rounded-lg p-3 mt-1 max-h-28 overflow-y-auto">{prompt}</p>
            </div>

            {/* ─────────── Kling Motion Control: required-inputs block at top ─────────── */}
            {isKlingMotion && (
              <div className="rounded-xl border border-border bg-muted/40 p-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Required inputs
                </p>

                {/* ① Reference video */}
                <div
                  ref={videoRowRef}
                  className={cn(
                    "rounded-lg p-2 space-y-2 transition-all",
                    highlightField === "video" && "ring-2 ring-destructive bg-destructive/5",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <NumberBadge n={1} />
                    <Label className="flex-1">Reference video <span className="text-muted-foreground font-normal">(motion source)</span></Label>
                    <StatusChip filled={assets.length > 0} />
                  </div>
                  {assets.length === 0 ? (
                    <Button type="button" variant="outline" onClick={() => setPickerOpen(true)} className="w-full justify-start">
                      <Library className="h-4 w-4" />
                      Choose video from gallery
                    </Button>
                  ) : (
                    <FilledRow
                      asset={assets[0]}
                      icon={Video}
                      onClear={() => setAssets([])}
                      onChange={() => setPickerOpen(true)}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Character actions in the output match this video. Whole / upper body visible, no obstruction.
                    Max 10s when orientation is "image", 30s when "video".
                  </p>
                  {v2vDurationOver && (
                    <p className="text-xs text-destructive font-medium">
                      This clip is {refVideoDuration!.toFixed(1)}s — over the {v2vDurationLimit}s limit for the current orientation.{" "}
                      {characterOrientation === "image"
                        ? `Switch orientation below to "Match reference video" (≤30s) or pick a shorter clip.`
                        : `Pick a shorter clip.`}
                    </p>
                  )}
                </div>

                {/* ② Reference image */}
                <div
                  ref={imageRowRef}
                  className={cn(
                    "rounded-lg p-2 space-y-2 transition-all",
                    highlightField === "image" && "ring-2 ring-destructive bg-destructive/5",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <NumberBadge n={2} />
                    <Label className="flex-1">Reference image <span className="text-muted-foreground font-normal">(appearance)</span></Label>
                    <StatusChip filled={!!referenceImage} />
                  </div>
                  {referenceImage ? (
                    <FilledRow
                      asset={referenceImage}
                      icon={ImageIcon}
                      onClear={() => setReferenceImage(null)}
                      onChange={() => setRefPickerOpen(true)}
                    />
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setRefPickerOpen(true)} className="w-full justify-start">
                      <Library className="h-4 w-4" />
                      Choose image from gallery
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Character, background, and other visuals in the output come from this image.
                    Clear body proportions, no occlusion, character occupies &gt;5% of the frame.
                  </p>
                </div>
              </div>
            )}

            {/* ─────────── Generic top picker (everything except V2V) ─────────── */}
            {showGenericTopPicker && (
              <div
                ref={isHeyGen ? null : null}
                className="space-y-2"
              >
                <Label>
                  {allowsMultiple ? "Media (in order)" :
                   isHeyGen ? "Face image" :
                   `Start ${pickerKind}`}
                </Label>
                <Button type="button" variant="outline" onClick={() => setPickerOpen(true)} className="w-full justify-start">
                  <Library className="h-4 w-4" />
                  {assets.length === 0
                    ? `Choose from Media Gallery`
                    : allowsMultiple
                      ? `${assets.length} selected — change`
                      : `Change selection`}
                </Button>
                {assets.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 pt-1">
                    {assets.map((a, i) => (
                      <li
                        key={a.id}
                        className="inline-flex items-center gap-1.5 text-xs bg-background border rounded-full pl-1 pr-2 py-0.5 max-w-[200px]"
                      >
                        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-blue-500 text-white text-[10px] font-bold shrink-0">
                          {i + 1}
                        </span>
                        <KindIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{a.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {allowsMultiple && (
                  <p className="text-xs text-muted-foreground">
                    The model receives images in this order. Refer to them in your prompt as "image 1", "image 2", etc.
                  </p>
                )}
              </div>
            )}

            {showAspectAndQuality && (
              <>
                <div className="space-y-2">
                  <Label>Aspect ratio</Label>
                  <Select value={aspect} onValueChange={(v) => setAspect(v as GenOptions["aspectRatio"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1:1">Square (1:1)</SelectItem>
                      <SelectItem value="16:9">Landscape (16:9)</SelectItem>
                      <SelectItem value="9:16">Portrait (9:16)</SelectItem>
                      <SelectItem value="4:3">4:3</SelectItem>
                      <SelectItem value="3:4">3:4</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Quality</Label>
                  <Select value={quality} onValueChange={(v) => setQuality(v as GenOptions["quality"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {isKlingV3Image && (
              <>
                <div className="space-y-2">
                  <Label>Duration (seconds)</Label>
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {KLING_DURATIONS.map((d) => (
                        <SelectItem key={d} value={d}>{d} sec</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Generate audio</Label>
                    <p className="text-xs text-muted-foreground">Native speech / sound for the video.</p>
                  </div>
                  <Switch checked={generateAudio} onCheckedChange={setGenerateAudio} />
                </div>

                <div className="space-y-2">
                  <Label>End image (optional)</Label>
                  {endImage ? (
                    <FilledRow asset={endImage} icon={ImageIcon} onClear={() => setEndImage(null)} onChange={() => setEndPickerOpen(true)} />
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setEndPickerOpen(true)} className="w-full justify-start">
                      <Library className="h-4 w-4" />
                      Choose end image from gallery
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Negative prompt</Label>
                  <Textarea
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    rows={2}
                    placeholder={DEFAULT_NEGATIVE}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>CFG scale</Label>
                    <span className="text-xs text-muted-foreground tabular-nums">{cfgScale.toFixed(2)}</span>
                  </div>
                  <Slider
                    min={0} max={1} step={0.05}
                    value={[cfgScale]}
                    onValueChange={(v) => setCfgScale(v[0] ?? 0.5)}
                  />
                  <p className="text-xs text-muted-foreground">How strictly the model follows your prompt (default 0.5).</p>
                </div>
              </>
            )}

            {/* ─────────── Kling Motion Control: secondary "Motion options" group ─────────── */}
            {isKlingMotion && (
              <div className="space-y-3 pt-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Motion options
                </p>

                <div className="space-y-2">
                  <Label>Character orientation</Label>
                  <Select value={characterOrientation} onValueChange={(v) => setCharacterOrientation(v as "image" | "video")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="image">Match reference image — better for camera moves (≤10s)</SelectItem>
                      <SelectItem value="video">Match reference video — better for complex motion (≤30s)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Keep original sound</Label>
                    <p className="text-xs text-muted-foreground">Carry audio from the reference video into the output.</p>
                  </div>
                  <Switch checked={keepOriginalSound} onCheckedChange={setKeepOriginalSound} />
                </div>

                <div className="space-y-2">
                  <Label>Facial element (optional)</Label>
                  {characterOrientation !== "video" ? (
                    <p className="text-xs text-muted-foreground">
                      Available only when orientation is "Match reference video".
                    </p>
                  ) : elementImage ? (
                    <FilledRow asset={elementImage} icon={ImageIcon} onClear={() => setElementImage(null)} onChange={() => setElementPickerOpen(true)} />
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setElementPickerOpen(true)} className="w-full justify-start">
                      <Library className="h-4 w-4" />
                      Choose facial element image
                    </Button>
                  )}
                  {characterOrientation === "video" && (
                    <p className="text-xs text-muted-foreground">
                      Improves facial identity preservation. Reference as <code>@Element1</code> in your prompt.
                    </p>
                  )}
                </div>
              </div>
            )}

            {isHeyGen && (
              <>
                <div
                  ref={audioRowRef}
                  className={cn(
                    "space-y-2 rounded-lg p-2 transition-all",
                    highlightField === "audio" && "ring-2 ring-destructive bg-destructive/5",
                  )}
                >
                  <Label>Audio clip (lip-sync source)</Label>
                  {audioAsset ? (
                    <FilledRow asset={audioAsset} icon={Mic2} onClear={() => setAudioAsset(null)} onChange={() => setAudioPickerOpen(true)} />
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setAudioPickerOpen(true)} className="w-full justify-start">
                      <Library className="h-4 w-4" />
                      Choose audio from gallery
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    The avatar will lip-sync to this audio. Billed per second of output video.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Talking style</Label>
                  <Select value={talkingStyle} onValueChange={(v) => setTalkingStyle(v as "stable" | "expressive")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stable">Stable — minimal movement</SelectItem>
                      <SelectItem value="expressive">Expressive — more animation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Resolution</Label>
                  <Select value={resolution} onValueChange={(v) => setResolution(v as typeof resolution)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="360p">360p</SelectItem>
                      <SelectItem value="480p">480p</SelectItem>
                      <SelectItem value="540p">540p</SelectItem>
                      <SelectItem value="720p">720p</SelectItem>
                      <SelectItem value="1080p">1080p</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Aspect ratio</Label>
                  <Select value={aspect} onValueChange={(v) => setAspect(v as GenOptions["aspectRatio"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="16:9">Landscape (16:9)</SelectItem>
                      <SelectItem value="9:16">Portrait (9:16)</SelectItem>
                      <SelectItem value="1:1">Square (1:1)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Captions</Label>
                    <p className="text-xs text-muted-foreground">Burn captions into the video.</p>
                  </div>
                  <Switch checked={caption} onCheckedChange={setCaption} />
                </div>
              </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="gap-2 px-6 py-3 border-t bg-background sm:rounded-b-lg">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Working…" : generateLabel}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {needsMedia && (
        <MediaGalleryPicker
          open={pickerOpen}
          userId={userId}
          kind={pickerKind}
          mode={pickerMode}
          maxSelected={16}
          initialSelectedIds={assets.map((a) => a.id)}
          onClose={() => setPickerOpen(false)}
          onConfirm={(picked) => { setAssets(picked); setPickerOpen(false); }}
        />
      )}

      {isKlingV3Image && (
        <MediaGalleryPicker
          open={endPickerOpen}
          userId={userId}
          kind="image"
          mode="single"
          initialSelectedIds={endImage ? [endImage.id] : []}
          onClose={() => setEndPickerOpen(false)}
          onConfirm={(picked) => { setEndImage(picked[0] ?? null); setEndPickerOpen(false); }}
        />
      )}

      {isKlingMotion && (
        <>
          <MediaGalleryPicker
            open={refPickerOpen}
            userId={userId}
            kind="image"
            mode="single"
            initialSelectedIds={referenceImage ? [referenceImage.id] : []}
            onClose={() => setRefPickerOpen(false)}
            onConfirm={(picked) => { setReferenceImage(picked[0] ?? null); setRefPickerOpen(false); }}
          />
          <MediaGalleryPicker
            open={elementPickerOpen}
            userId={userId}
            kind="image"
            mode="single"
            initialSelectedIds={elementImage ? [elementImage.id] : []}
            onClose={() => setElementPickerOpen(false)}
            onConfirm={(picked) => { setElementImage(picked[0] ?? null); setElementPickerOpen(false); }}
          />
        </>
      )}

      {isHeyGen && (
        <MediaGalleryPicker
          open={audioPickerOpen}
          userId={userId}
          kind="audio"
          mode="single"
          initialSelectedIds={audioAsset ? [audioAsset.id] : []}
          onClose={() => setAudioPickerOpen(false)}
          onConfirm={(picked) => { setAudioAsset(picked[0] ?? null); setAudioPickerOpen(false); }}
        />
      )}
    </>
  );
};
