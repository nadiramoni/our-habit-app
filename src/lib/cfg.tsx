"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ServerCfg, mergeServerCfg } from "./types";
import { fetchRemoteMeta } from "./cloud";
import { BAKED_SERVER_CFG } from "./baked-cfg";

interface CfgCtx {
  cfg: ServerCfg;
  loaded: boolean;
  refresh: () => Promise<void>;
}

const CfgContext = createContext<CfgCtx>({ cfg: mergeServerCfg(null), loaded: false, refresh: async () => undefined });

export function ServerCfgProvider({ children }: { children: React.ReactNode }) {
  const [cfg, setCfg] = useState<ServerCfg>(() => mergeServerCfg(null));
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/config", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) {
        setCfg(mergeServerCfg(j.cfg));
        setLoaded(true);
        return;
      }
    } catch {
      /* offline / APK static build — fall through to Firebase meta */
    }
    // APK/static mode: no server → pull ads + update config from the owner's Firebase
    try {
      const meta = await fetchRemoteMeta();
      if (meta && (meta.adsEnabled || meta.firebase?.on || meta.latestVersion)) {
        setCfg(mergeServerCfg(meta));
        setLoaded(true);
        return;
      }
    } catch {
      /* keep current */
    }
    // Last resort: the config baked into THIS build (owner's real ads/firebase).
    // Guarantees ads + update settings exist even fully offline, first run.
    if (BAKED_SERVER_CFG) {
      try {
        const baked = JSON.parse(BAKED_SERVER_CFG) as Partial<ServerCfg>;
        setCfg(mergeServerCfg(baked));
        setLoaded(true);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void refresh(), 0);
    const iv = setInterval(() => void refresh(), 5 * 60 * 1000); // every 5 min — admin changes go live fast
    return () => {
      clearTimeout(id);
      clearInterval(iv);
    };
  }, [refresh]);

  return <CfgContext.Provider value={{ cfg, loaded, refresh }}>{children}</CfgContext.Provider>;
}

export function useServerCfg(): CfgCtx {
  return useContext(CfgContext);
}
