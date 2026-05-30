// Human: Password field with show/hide toggle — mirrors Pencil lock + eye icon row.
// Agent: LOCAL STATE for visibility; WRITES type on underlying input only.

import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { AuthIconField } from "@/components/auth/AuthIconField";

type AuthPasswordFieldProps = {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  "aria-invalid"?: boolean;
};

export function AuthPasswordField({
  label,
  id,
  value,
  onChange,
  autoComplete,
  required,
  "aria-invalid": ariaInvalid,
}: AuthPasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <AuthIconField
      id={id}
      label={label}
      icon={Lock}
      type={visible ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      required={required}
      aria-invalid={ariaInvalid}
      trailing={
        <button
          type="button"
          className="shrink-0 text-[#888888] transition-colors hover:text-[#666666]"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  );
}
