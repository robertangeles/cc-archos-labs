"use client";

import { useState, useEffect } from "react";

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  description?: string;
  inputCost?: number;
  outputCost?: number;
}

export function useEnabledModels() {
  const [models, setModels] = useState<ModelEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/skills/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.models) setModels(data.models);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return models;
}
