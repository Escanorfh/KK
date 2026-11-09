import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export type PlatformType = "native" | "ios" | "unsupported";

const DISMISSED_KEY = "efms_pwa_install_dismissed_until";
const DISMISS_DURATION_DAYS = 7; // Do not nag the user for 7 days if dismissed

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isPromptAccepted, setIsPromptAccepted] = useState(false);
  const [platform, setPlatform] = useState<PlatformType>("unsupported");
  const [dismissed, setDismissed] = useState(false);

  // Check standalone mode reliably
  const checkStandalone = useCallback(() => {
    if (typeof window === "undefined") return false;
    const isStandaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      document.referrer.includes("android-app://");
    return isStandaloneMode;
  }, []);

  // Detect iOS (iPhone/iPad/iPod, including iPadOS desktop mode) and Safari
  const detectIOS = useCallback(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    const platformStr = navigator.platform || "";
    // iPhone, iPod, or iPad (or iPadOS requesting desktop site presenting as MacIntel with touch points)
    const isIOSDevice =
      /iPad|iPhone|iPod/.test(ua) ||
      (platformStr === "MacIntel" && navigator.maxTouchPoints > 1);

    if (!isIOSDevice) return false;

    // Detect if running in Safari (not Chrome CriOS, Firefox FxiOS, Edge EdgiOS, Opera OPiOS)
    const isWebKit = /WebKit/.test(ua);
    const isThirdPartyBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua);
    const isSafari = isWebKit && /Safari/.test(ua) && !isThirdPartyBrowser;

    return isSafari;
  }, []);

  // Check dismissal persistence
  const checkDismissed = useCallback(() => {
    try {
      const stored = localStorage.getItem(DISMISSED_KEY);
      if (!stored) return false;
      const until = Number(stored);
      if (Number.isNaN(until)) return false;
      return Date.now() < until;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const standaloneNow = checkStandalone();
    setIsStandalone(standaloneNow);
    if (standaloneNow) {
      setIsInstalled(true);
      return;
    }

    setDismissed(checkDismissed());

    if (detectIOS()) {
      setPlatform("ios");
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setPlatform("native");
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    const mql = window.matchMedia("(display-mode: standalone)");
    const handleMql = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches);
      if (e.matches) setIsInstalled(true);
    };
    if (mql.addEventListener) {
      mql.addEventListener("change", handleMql);
    } else {
      mql.addListener(handleMql);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      if (mql.removeEventListener) {
        mql.removeEventListener("change", handleMql);
      } else {
        mql.removeListener(handleMql);
      }
    };
  }, [checkStandalone, detectIOS, checkDismissed]);

  const installNative = async (): Promise<"accepted" | "dismissed" | "failed"> => {
    if (!deferredPrompt) return "failed";
    const promptEvent = deferredPrompt;
    // Clear deferred prompt reference immediately to prevent reuse
    setDeferredPrompt(null);
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") {
        setIsPromptAccepted(true);
      }
      return choice.outcome;
    } catch (err) {
      console.error("Install prompt error:", err);
      return "failed";
    }
  };

  const dismissPrompt = () => {
    setDismissed(true);
    try {
      const until = Date.now() + DISMISS_DURATION_DAYS * 24 * 60 * 60 * 1000;
      localStorage.setItem(DISMISSED_KEY, until.toString());
    } catch (e) {
      console.warn("Unable to store install dismissal preference:", e);
    }
  };

  const shouldShowPrompt =
    !isStandalone &&
    !isInstalled &&
    !isPromptAccepted &&
    !dismissed &&
    (platform === "native" || platform === "ios");

  return {
    isStandalone,
    isInstalled,
    isPromptAccepted,
    canInstallNative: Boolean(deferredPrompt),
    platform,
    dismissed,
    shouldShowPrompt,
    installNative,
    dismissPrompt,
  };
}

