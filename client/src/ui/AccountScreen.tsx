import { useState, type FormEvent } from "react";
import { ArrowLeft, UserRound } from "lucide-react";
import type { Account } from "../../../shared/statistics";
import { profilePath, rename, signIn, signOut, type AccountSession } from "../network/accountApi";

type Props = {
  account: Account | null;
  onChange: (session: AccountSession) => void;
  navigate: (path: string) => void;
  forStats?: boolean;
};

const namePattern = "[A-Z][A-Za-z0-9]{4,14}";

export default function AccountScreen({ account, onChange, navigate, forStats }: Props) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function run(work: () => Promise<AccountSession>, changed?: () => void) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      onChange(await work());
      changed?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Le compte est momentanément indisponible.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (account) void run(() => rename(String(data.get("name"))), () => setNotice("Pseudo enregistré."));
    else void run(() => signIn(String(data.get("handle")), String(data.get("password")), creating),
      () => { if (!forStats && !/^\/(parties|bilans|mes-parties)(\/|$)/.test(location.pathname)) navigate("/"); });
  }

  return (
    <main className="archive-screen">
      <section className="account-card">
        <a className="archive-back" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>
          <ArrowLeft size={17} aria-hidden="true" /> Accueil
        </a>
        <h1><UserRound aria-hidden="true" /> {account ? "Mon compte" : creating ? "Créer un compte" : "Connexion"}</h1>
        {forStats && <p>Connecte-toi pour retrouver tes statistiques personnelles.</p>}
        <form onSubmit={submit} key={account?.id ?? String(creating)}>
          {account ? <>
            <p>Identifiant de connexion <strong>{account.handle}</strong></p>
            <label>Pseudo <input name="name" required pattern={namePattern} minLength={5} maxLength={15}
              defaultValue={account.name} autoCapitalize="off" aria-describedby="pseudo-format" /></label>
          </> : <>
            <label>Identifiant <input name="handle" required pattern={creating ? namePattern : "[A-Za-z][A-Za-z0-9]{4,14}"}
              minLength={5} maxLength={15} autoComplete="username" autoCapitalize="off"
              aria-describedby={creating ? "pseudo-format" : undefined} /></label>
            <label>Mot de passe <input name="password" type="password" required minLength={5} maxLength={128}
              autoComplete={creating ? "new-password" : "current-password"} /></label>
          </>}
          {(account || creating) && <p id="pseudo-format">5 à 15 lettres ou chiffres, avec une majuscule au début.</p>}
          {notice && <p role="status">{notice}</p>}
          {error && <p className="archive-error" role="alert">{error}</p>}
          <button className="archive-primary" type="submit" disabled={busy}>
            {account ? "Enregistrer le pseudo" : creating ? "Créer mon compte" : "Se connecter"}
          </button>
        </form>
        {account ? <div className="archive-actions">
          <a href={profilePath(account.id)} onClick={(event) => { event.preventDefault(); navigate(profilePath(account.id)); }}>Mon profil public</a>
          <button type="button" disabled={busy} onClick={() => void run(signOut, () => navigate("/"))}>Se déconnecter</button>
        </div> : <button type="button" disabled={busy} onClick={() => { setCreating(!creating); setError(""); }}>
          {creating ? "J’ai déjà un compte" : "Créer un compte"}
        </button>}
      </section>
    </main>
  );
}
