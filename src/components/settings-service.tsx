"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createProviderSettingsQueue } from "../lib/provider-settings.ts";

const CONNECTION_STATE_CLASSES = {
  "Loading configuration…": "",
  "Checking…": "",
  "Unsaved changes": "",
  "Not configured": "",
  "Not checked": "",
  Connected: "is-ok",
  "Connection failed": "is-error",
  "Configuration error": "is-error",
} as const;
export type ConnectionStateLabel = keyof typeof CONNECTION_STATE_CLASSES;

export function ConnectionState({ state }: { state: ConnectionStateLabel }) {
  return (
    <span className={"connection-state " + CONNECTION_STATE_CLASSES[state]}>
      {state}
    </span>
  );
}

export function SettingsServiceHeading({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="settings-service-summary">
      <div className="settings-service-heading">
        <h2 id={id}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="settings-service-buttons">{children}</div>}
    </div>
  );
}

export type RunSettingsOperation = <T>(
  operation: () => Promise<T>,
) => Promise<T>;
export type SettingsOperations = {
  saving: boolean;
  runOperation: RunSettingsOperation;
};

/** All settings writes and probes share a queue, including across hidden tabs.
 * A probe sees the saved settings; concurrent PATCH snapshots cannot undo one
 * another. A rejected operation releases the queue for the next request. */
export function useSettingsOperations(): SettingsOperations {
  const [saving, setSaving] = useState(false);
  const [runQueued] = useState(createProviderSettingsQueue);
  const operationCount = useRef(0);
  const runOperation: RunSettingsOperation = useCallback(
    async (operation) => {
      operationCount.current++;
      setSaving(true);
      try {
        return await runQueued(operation);
      } finally {
        operationCount.current--;
        if (operationCount.current === 0) setSaving(false);
      }
    },
    [runQueued],
  );
  return { saving, runOperation };
}

/** Closing an inline editor returns focus to Edit. While a post-save probe
 * disables Edit, the save notice keeps keyboard focus on the same card. */
export function useEditorFocusReturn(editing: boolean) {
  const editRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const closePending = useRef(false);
  useEffect(() => {
    if (editing) {
      closePending.current = true;
      return;
    }
    if (!closePending.current) return;
    closePending.current = false;
    const edit = editRef.current;
    if (edit && !edit.disabled) edit.focus();
    else noticeRef.current?.focus();
  }, [editing]);
  return { editRef, noticeRef };
}
