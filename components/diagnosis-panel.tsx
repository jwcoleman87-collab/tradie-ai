'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from './workbench-controls';
import { requestApi } from '@/lib/client';
import type { DiagnosisResult, DiagnosisTarget } from '@/lib/diagnosis';

export function DiagnosisPanel({
  token,
  workspaceId,
  kind,
  targetId,
  disabled = false,
}: DiagnosisTarget & { token: string; disabled?: boolean }) {
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function inspect() {
    if (controller.current) return;
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const value = await requestApi<DiagnosisResult>(
        token,
        'diagnosis',
        'POST',
        { workspaceId, kind, targetId },
        pending.signal,
      );
      if (!pending.signal.aborted) setResult(value);
    } catch (reason) {
      if (!pending.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Diagnosis could not load.',
        );
    } finally {
      if (!pending.signal.aborted) setBusy(false);
      controller.current = null;
    }
  }
  return (
    <section className="mt-4 border-t pt-3" aria-label="Failure diagnosis">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={() => void inspect()}
      >
        {busy
          ? 'Diagnosing…'
          : result
            ? 'Refresh diagnosis'
            : 'Diagnose this failure'}
      </Button>
      <p className="auth-hint mt-2">
        Uses AI to inspect saved error details. API charges apply. Nothing is
        retried or changed.
      </p>
      {busy && (
        <output>Reading the evidence and preparing recommendations…</output>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div aria-live="polite" className="mt-3 space-y-3">
          <p className="auth-hint">
            Snapshot: {new Date(result.observedAt).toLocaleString()}. This
            report does not update automatically.
          </p>
          {result.report ? (
            <>
              <div>
                <h4 className="font-semibold">Likely cause</h4>
                <p>{result.report.likelyCause}</p>
                <p className="auth-hint">
                  AI assessment · {result.report.confidence} confidence
                </p>
              </div>
              <div>
                <h4 className="font-semibold">Recommended next steps</h4>
                <ol className="list-decimal pl-5 space-y-2">
                  {result.report.recommendations.map((item, index) => (
                    <li key={index}>
                      <strong>
                        {item.owner === 'app_operator'
                          ? 'Workbench operator'
                          : 'Workspace owner'}
                        :
                      </strong>{' '}
                      {item.step}
                    </li>
                  ))}
                </ol>
              </div>
              {!!result.report.missingEvidence.length && (
                <div>
                  <h4 className="font-semibold">What is still unknown</h4>
                  <ul className="list-disc pl-5">
                    {result.report.missingEvidence.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p>
              AI diagnosis is unavailable ({result.unavailableCode}). The
              recorded evidence below is still available; no fix has been
              attempted.
            </p>
          )}
          <details>
            <summary className="cursor-pointer">Recorded evidence</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(result.evidence, null, 2)}
            </pre>
          </details>
          <p className="auth-hint break-all">
            {result.model} ·{' '}
            {result.usage
              .reduce((sum, item) => sum + item.inputTokens, 0)
              .toLocaleString()}{' '}
            input tokens ·{' '}
            {result.usage
              .reduce((sum, item) => sum + item.outputTokens, 0)
              .toLocaleString()}{' '}
            output tokens · Reference: {result.requestId}
          </p>
        </div>
      )}
    </section>
  );
}
