import type { FormEvent, RefObject } from "react";
import { ADDRESS_REGEX, HANDLE_REGEX } from "@/lib/constants";

export interface AddressFormProps {
  address: string;
  handle: string;
  onAddressChange: (value: string) => void;
  onHandleChange: (value: string) => void;
  onSubmit: () => void;
  /** True while a request is in flight or the reveal is running. */
  disabled: boolean;
  chainLine?: string;
  addressInputRef?: RefObject<HTMLInputElement | null>;
}

export function isValidAddress(value: string): boolean {
  return ADDRESS_REGEX.test(value.trim());
}

/** A handle is valid when empty (optional) or 1-15 word chars after stripping one leading @. */
export function isValidHandle(value: string): boolean {
  const stripped = value.trim().replace(/^@/, "");
  return stripped === "" || HANDLE_REGEX.test(stripped);
}

export default function AddressForm({
  address,
  handle,
  onAddressChange,
  onHandleChange,
  onSubmit,
  disabled,
  chainLine,
  addressInputRef,
}: AddressFormProps) {
  const addressValid = isValidAddress(address);
  const handleValid = isValidHandle(handle);
  const showAddressHint = address.trim() !== "" && !addressValid;
  const showHandleHint = handle.trim() !== "" && !handleValid;
  const canSubmit = addressValid && handleValid && !disabled;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (canSubmit) onSubmit();
  }

  const inputClass =
    "min-h-[44px] w-full rounded-lg border bg-[var(--lab-surface-2)] px-3 text-base text-[var(--lab-text)] placeholder:text-[var(--lab-muted)] focus:outline-2 focus:outline-offset-2 focus:outline-[var(--stitch-green)]";

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      <div>
        <label htmlFor="address" className="sr-only">
          Token contract address
        </label>
        <input
          id="address"
          ref={addressInputRef}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Paste a token contract address (0x…)"
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          disabled={disabled}
          aria-invalid={showAddressHint}
          aria-describedby={showAddressHint ? "address-hint" : undefined}
          className={inputClass}
          style={{ borderColor: showAddressHint ? "var(--rot-red)" : "var(--lab-border)" }}
        />
        {showAddressHint && (
          <p id="address-hint" className="mt-1 text-sm" style={{ color: "var(--rot-red)" }}>
            That doesn&apos;t look like an address. An address is 0x followed by 40 hex characters.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="handle" className="mb-1 block text-sm text-[var(--lab-muted)]">
          Project&apos;s X handle (optional, for the reputation check)
        </label>
        <input
          id="handle"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="@handle"
          value={handle}
          onChange={(e) => onHandleChange(e.target.value)}
          disabled={disabled}
          aria-invalid={showHandleHint}
          aria-describedby={showHandleHint ? "handle-hint" : undefined}
          className={inputClass}
          style={{ borderColor: showHandleHint ? "var(--rot-red)" : "var(--lab-border)" }}
        />
        {showHandleHint && (
          <p id="handle-hint" className="mt-1 text-sm" style={{ color: "var(--rot-red)" }}>
            An X handle is 1–15 letters, numbers, or underscores.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="min-h-[44px] w-full rounded-lg px-4 text-lg font-black tracking-widest text-black transition-opacity focus:outline-2 focus:outline-offset-2 focus:outline-white disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: "var(--stitch-green)" }}
      >
        STITCH IT
      </button>

      {chainLine && (
        <p className="text-center text-sm font-semibold" style={{ color: "var(--stitch-green)" }}>
          {chainLine}
        </p>
      )}
    </form>
  );
}
