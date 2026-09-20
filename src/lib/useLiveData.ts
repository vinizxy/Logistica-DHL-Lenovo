"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

export type Connection = "connecting" | "online" | "offline";

const TABLES = ["box_models", "orders", "order_items", "order_events"] as const;
const DEBOUNCE_MS = 150; // uma ação toca várias tabelas; agrupa num refetch só
const POLL_OFFLINE_MS = 15_000; // se o Realtime cair, continua atualizando por polling
const OFFLINE_GRACE_MS = 4_000; // só avisa "sem conexão" se a queda durar mais que isso

/**
 * Carrega dados com `fetcher` e recarrega sempre que qualquer tabela do sistema
 * muda (Supabase Realtime). Se o canal cair, faz polling até voltar.
 * `fetcher` precisa ter identidade estável (função de módulo ou useCallback).
 */
export function useLiveData<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    try {
      setData(await fetcher());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [fetcher]);

  useEffect(() => {
    let active = true; // ignora callbacks do canal depois do cleanup (StrictMode remonta)
    // Carga inicial fora do corpo síncrono do effect (regra react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => {
      if (active) void refetch();
    });

    const schedule = () => {
      if (!active) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refetch(), DEBOUNCE_MS);
    };

    let channel = supabase.channel(`live-${Math.random().toString(36).slice(2)}`);
    for (const table of TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        schedule,
      );
    }
    channel.subscribe((status) => {
      if (!active) return;
      if (status === "SUBSCRIBED") {
        if (offlineTimer.current) clearTimeout(offlineTimer.current);
        offlineTimer.current = null;
        setConnection("online");
        schedule(); // pode ter perdido algo enquanto reconectava
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        // A primeira tentativa de WebSocket às vezes falha e reconecta em seguida;
        // não vale a pena alarmar por isso. O cliente Realtime já tenta de novo sozinho.
        if (!offlineTimer.current) {
          offlineTimer.current = setTimeout(() => {
            if (active) setConnection("offline");
          }, OFFLINE_GRACE_MS);
        }
      }
    });

    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      offlineTimer.current = null;
      void supabase.removeChannel(channel);
    };
  }, [refetch]);

  useEffect(() => {
    if (connection !== "offline") return;
    const id = setInterval(() => void refetch(), POLL_OFFLINE_MS);
    return () => clearInterval(id);
  }, [connection, refetch]);

  return { data, error, connection, refetch };
}
