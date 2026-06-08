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
  const [defaultModel, setDefaultModel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/skills/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.models) setModels(data.models);
        if (data?.defaultModel) setDefaultModel(data.defaultModel);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, defaultModel };
}
