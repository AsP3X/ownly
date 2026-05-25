// Human: Sign-in page for returning users after setup is complete.
// Agent: CALLS login API; setAuth; navigate "/"; READS registration setting for optional sign-up link.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Cloud } from "lucide-react";
import { getErrorMessage, login, registrationSetting } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth, token } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [allowRegister, setAllowRegister] = useState(false);

  useEffect(() => {
    if (token) navigate("/", { replace: true });
  }, [token, navigate]);

  useEffect(() => {
    registrationSetting()
      .then((res) => setAllowRegister(res.allow_public_registration))
      .catch(() => undefined);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(email.trim(), password);
      if (!res.token) {
        setError("Login did not return a session token.");
        return;
      }
      setAuth(res.token, res.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Cloud className="size-5" />
          </div>
          <CardTitle>Sign in to MediaVault</CardTitle>
          <CardDescription>Access your files from anywhere.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Signing in…" : "Sign in"}
            </Button>
            {allowRegister && (
              <p className="text-center text-sm text-muted-foreground">
                No account?{" "}
                <Link to="/register" className="text-primary hover:underline">
                  Create one
                </Link>
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
