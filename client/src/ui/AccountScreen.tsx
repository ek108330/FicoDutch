import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, UserRound } from "lucide-react";
import type { Account } from "../../../shared/statistics";
import { checkNameAvailability, profilePath, rename, saveAvatar, saveAvatarPhoto, signIn, signOut, type AccountSession } from "../network/accountApi";
import PlayerAvatar from "./PlayerAvatar";
import { generateAvatarStyle, prepareAvatarPhoto } from "./playerAvatarConfig";

type Props = {
  account: Account | null;
  onChange: (session: AccountSession) => void;
  navigate: (path: string) => void;
  forStats?: boolean;
  startRegistration?: boolean;
};

const namePattern = "[A-Za-z][A-Za-z0-9]{4,14}";
const validName = new RegExp(`^${namePattern}$`);

export default function AccountScreen({ account, onChange, navigate, forStats, startRegistration = false }: Props) {
  const [creating, setCreating] = useState(startRegistration);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pseudo, setPseudo] = useState<string>();
  const [availability, setAvailability] = useState<{ name: string; available: boolean }>();
  const [photo, setPhoto] = useState<File>();
  const name = pseudo ?? account?.name ?? "";
  const normalizedName = name.charAt(0).toUpperCase() + name.slice(1);
  const candidate = account && normalizedName !== account.name && validName.test(name) ? normalizedName : "";
  const canRename = !!candidate && availability?.name === candidate && availability.available;

  useEffect(() => {
    if (!candidate) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void checkNameAvailability(candidate, controller.signal).then(({ available }) => {
        if (!controller.signal.aborted) setAvailability({ name: candidate, available });
      }, () => {});
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [candidate, name]);

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
    if (account) {
      if (canRename) void run(() => rename(normalizedName), () => {
        setPseudo(undefined);
        setNotice("Pseudo enregistré.");
      });
    }
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
        {account && <section className="account-avatar-form" aria-label="Icône du profil">
          <PlayerAvatar id={account.id} name={account.name} style={account.avatarStyle} photoId={account.avatarPhotoId} />
          <button type="button" disabled={busy} onClick={() =>
            void run(() => saveAvatar(generateAvatarStyle(account.id, account.avatarStyle)), () => {
              setPhoto(undefined);
              setNotice("Icône enregistrée.");
            })}>
            Générer une icône
          </button>
        </section>}
        {account && <section className="account-photo-form">
          <p id="photo-format">La photo publique est recadrée en cercle et réduite à 128 × 128 px.</p>
          <div className="archive-actions">
            <label className="account-photo-picker">
              <span>Choisir une photo</span>
              <input name="photo" type="file" accept="image/*" disabled={busy} aria-label="Photo de profil"
                aria-describedby="photo-format" onChange={(event) => {
                  if (event.currentTarget.files?.[0]) setPhoto(event.currentTarget.files[0]);
                  event.currentTarget.value = "";
                }} />
            </label>
            {photo && <button type="button" disabled={busy} onClick={() =>
              void run(async () => saveAvatarPhoto(await prepareAvatarPhoto(photo)), () => {
                setPhoto(undefined);
                setNotice("Photo enregistrée.");
              })}>Enregistrer la photo</button>}
            {account.avatarPhotoId && <button type="button" disabled={busy}
              onClick={() => void run(() => saveAvatarPhoto(null), () => setNotice("Photo retirée."))}>Retirer la photo</button>}
          </div>
          {photo && <p className="account-photo-name">{photo.name}</p>}
        </section>}
        <form onSubmit={submit} key={account?.id ?? String(creating)}>
          {account ? <>
            <p>Identifiant de connexion <strong>{account.handle}</strong></p>
            <label htmlFor="account-pseudo">Pseudo</label>
            <div className="account-pseudo-row">
              <input id="account-pseudo" name="name" required pattern={namePattern} value={name} autoCapitalize="off"
                aria-describedby="pseudo-format" onChange={(event) => {
                  setPseudo(event.target.value);
                  setAvailability(undefined);
                  setNotice("");
                }} />
              <button className="archive-primary" type="submit" disabled={busy || !canRename}>Changer</button>
            </div>
          </> : <>
            <label>Identifiant <input name="handle" required pattern={namePattern}
              minLength={5} maxLength={15} autoComplete="username" autoCapitalize="off"
              aria-describedby={creating ? "pseudo-format" : undefined} /></label>
            <label>Mot de passe <input name="password" type="password" required minLength={5} maxLength={128}
              autoComplete={creating ? "new-password" : "current-password"} /></label>
          </>}
          {(account || creating) && <p id="pseudo-format">
            {candidate && availability?.name === candidate && !availability.available
              ? "Ce pseudo est déjà utilisé." : "5 à 15 lettres ou chiffres, avec une lettre au début."}
          </p>}
          {notice && <p role="status">{notice}</p>}
          {error && <p className="archive-error" role="alert">{error}</p>}
          {!account && <button className="archive-primary" type="submit" disabled={busy}>
            {creating ? "Créer mon compte" : "Se connecter"}
          </button>}
        </form>
        {account ? <div className="archive-actions">
          <a href={profilePath(account.id)} onClick={(event) => { event.preventDefault(); navigate(profilePath(account.id)); }}>Mon profil public</a>
          <button className="account-danger" type="button" disabled={busy}
            onClick={() => void run(signOut, () => navigate("/"))}>Se déconnecter</button>
        </div> : <button type="button" disabled={busy} onClick={() => { setCreating(!creating); setError(""); }}>
          {creating ? "J’ai déjà un compte" : "Créer un compte"}
        </button>}
      </section>
    </main>
  );
}
