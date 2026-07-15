import { useCallback, useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Button } from '@shared/components';
import { Input } from '@shared/components';
import { Card } from '@shared/components';
import { useLanguage } from '../lib/LanguageContext';
import { useAuth } from '../lib/AuthContext';
import { api, UserProfile } from '../lib/api';
import { ApiError } from '@shared/api/errors';
import './Auth.css';

interface BankData {
  iban: string;
  bic: string;
}

const EMPTY_PROFILE: UserProfile = {
  email: '',
  vorname: '',
  nachname: '',
  telefon: '',
  adresse: { strasse: '', hausnr: '', plz: '', ort: '', land: 'DE' },
  user_state: '',
  created_at: '',
};

const EMPTY_BANK: BankData = { iban: '', bic: '' };

/**
 * Live profile page.
 *
 * - On mount, fetches GET /users/me and GET /users/me/refund-data. The refund
 *   endpoint is the only place iban/bic are returned; the profile endpoint
 *   omits them.
 * - Save-personal: PATCH /users/me with just the editable subset (vorname,
 *   nachname, telefon, adresse). Email is read-only — the backend does not
 *   support changing it here.
 * - Save-bank: PATCH /users/me/bank with { iban, bic }.
 * - Delete: DELETE /users/me with the entered password in the body; logs the
 *   user out and returns to home on success.
 */
export const ProfilePage = () => {
  const { t } = useLanguage();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [bankData, setBankData] = useState<BankData>(EMPTY_BANK);
  // Snapshots taken at load / after successful save — used to revert on cancel.
  const [profileSnapshot, setProfileSnapshot] = useState<UserProfile>(EMPTY_PROFILE);
  const [bankSnapshot, setBankSnapshot] = useState<BankData>(EMPTY_BANK);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [editingBank, setEditingBank] = useState(false);
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [personalError, setPersonalError] = useState('');
  const [bankError, setBankError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      // Fetch both in parallel — they hit different Lambda routes so there's
      // no read-after-write ordering to worry about.
      const [me, refund] = await Promise.all([api.getProfile(), api.getRefundData()]);
      setProfile(me);
      setProfileSnapshot(me);
      const nextBank: BankData = { iban: refund.iban ?? '', bic: refund.bic ?? '' };
      setBankData(nextBank);
      setBankSnapshot(nextBank);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.body.message || t.auth.profile.loadError : t.auth.profile.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.auth.profile.loadError]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handleSavePersonal = async (e?: FormEvent) => {
    e?.preventDefault();
    setPersonalError('');
    setSavingPersonal(true);
    try {
      const updated = await api.updateProfile({
        vorname: profile.vorname,
        nachname: profile.nachname,
        telefon: profile.telefon,
        adresse: profile.adresse,
      });
      setProfile(updated);
      setProfileSnapshot(updated);
      setEditingPersonal(false);
    } catch (err) {
      setPersonalError(
        err instanceof ApiError ? err.body.message || t.auth.profile.updateError : t.auth.profile.updateError,
      );
    } finally {
      setSavingPersonal(false);
    }
  };

  const handleSaveBank = async (e?: FormEvent) => {
    e?.preventDefault();
    setBankError('');
    setSavingBank(true);
    try {
      const updated = await api.updateBank(bankData.iban, bankData.bic);
      const next: BankData = { iban: updated.iban, bic: updated.bic };
      setBankData(next);
      setBankSnapshot(next);
      setEditingBank(false);
    } catch (err) {
      setBankError(
        err instanceof ApiError ? err.body.message || t.auth.profile.updateError : t.auth.profile.updateError,
      );
    } finally {
      setSavingBank(false);
    }
  };

  const handleDeleteAccount = async (e?: FormEvent) => {
    e?.preventDefault();
    setDeleteError('');
    setDeleting(true);
    try {
      await api.deleteAccount(confirmPassword);
      logout();
      navigate('/');
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.body.message || t.auth.profile.updateError : t.auth.profile.updateError,
      );
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="profile-page">
        <Header />
        <main className="profile-container">
          <p>{t.auth.profile.loading}</p>
        </main>
        <Footer />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="profile-page">
        <Header />
        <main className="profile-container">
          <div className="error-message">{loadError}</div>
          <Button variant="primary" onClick={() => void loadProfile()}>
            {t.auth.profile.edit /* reused as generic retry label */}
          </Button>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="profile-page">
      <Header />
      <main className="profile-container">
        <h1 className="h1">{t.auth.profile.title}</h1>
        <p className="profile-subtitle">{t.auth.profile.subtitle}</p>

        <Card className="profile-section">
          <div className="section-header">
            <h2 className="h2">{t.auth.profile.personalTitle}</h2>
            {!editingPersonal && (
              <Button variant="secondary" onClick={() => setEditingPersonal(true)}>
                {t.auth.profile.edit}
              </Button>
            )}
          </div>
          {editingPersonal ? (
            <form onSubmit={handleSavePersonal}>
              <Input
                label={t.auth.register.vorname}
                name="given-name"
                autoComplete="given-name"
                value={profile.vorname}
                onChange={(e) => setProfile({ ...profile, vorname: e.target.value })}
              />
              <Input
                label={t.auth.register.nachname}
                name="family-name"
                autoComplete="family-name"
                value={profile.nachname}
                onChange={(e) => setProfile({ ...profile, nachname: e.target.value })}
              />
              <Input
                label={t.auth.register.telefon}
                type="tel"
                name="tel"
                autoComplete="tel"
                inputMode="tel"
                value={profile.telefon}
                onChange={(e) => setProfile({ ...profile, telefon: e.target.value })}
              />
              <Input
                label={t.auth.register.strasse}
                name="address-line1"
                autoComplete="address-line1"
                value={profile.adresse.strasse}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    adresse: { ...profile.adresse, strasse: e.target.value },
                  })
                }
              />
              <Input
                label={t.auth.register.hausnr}
                name="address-line2"
                autoComplete="address-line2"
                value={profile.adresse.hausnr}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    adresse: { ...profile.adresse, hausnr: e.target.value },
                  })
                }
              />
              <Input
                label={t.auth.register.plz}
                name="postal-code"
                autoComplete="postal-code"
                inputMode="numeric"
                value={profile.adresse.plz}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    adresse: { ...profile.adresse, plz: e.target.value },
                  })
                }
              />
              <Input
                label={t.auth.register.ort}
                name="address-level2"
                autoComplete="address-level2"
                value={profile.adresse.ort}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    adresse: { ...profile.adresse, ort: e.target.value },
                  })
                }
              />
              {personalError && <div className="error-message">{personalError}</div>}
              <div className="button-group">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setEditingPersonal(false);
                    setPersonalError('');
                    // Revert unsaved changes to the last-known-good snapshot.
                    setProfile(profileSnapshot);
                  }}
                >
                  {t.auth.profile.cancel}
                </Button>
                <Button type="submit" variant="primary" disabled={savingPersonal}>
                  {t.auth.profile.save}
                </Button>
              </div>
            </form>
          ) : (
            <div className="profile-data">
              <p>
                <strong>{t.auth.register.vorname}:</strong> {profile.vorname}
              </p>
              <p>
                <strong>{t.auth.register.nachname}:</strong> {profile.nachname}
              </p>
              <p>
                <strong>{t.auth.register.email}:</strong> {profile.email}
              </p>
              <p>
                <strong>{t.auth.register.telefon}:</strong> {profile.telefon}
              </p>
              <p>
                <strong>{t.auth.register.strasse}:</strong> {profile.adresse.strasse}{' '}
                {profile.adresse.hausnr}
              </p>
              <p>
                <strong>
                  {t.auth.register.plz} {t.auth.register.ort}:
                </strong>{' '}
                {profile.adresse.plz} {profile.adresse.ort}
              </p>
            </div>
          )}
        </Card>

        <Card className="profile-section">
          <div className="section-header">
            <h2 className="h2">{t.auth.profile.bankTitle}</h2>
            {!editingBank && (
              <Button variant="secondary" onClick={() => setEditingBank(true)}>
                {t.auth.profile.edit}
              </Button>
            )}
          </div>
          {editingBank ? (
            <form onSubmit={handleSaveBank}>
              <Input
                label={t.auth.register.iban}
                name="iban"
                autoCapitalize="characters"
                spellCheck={false}
                value={bankData.iban}
                onChange={(e) => setBankData({ ...bankData, iban: e.target.value })}
              />
              <Input
                label={t.auth.register.bic}
                name="bic"
                autoCapitalize="characters"
                spellCheck={false}
                value={bankData.bic}
                onChange={(e) => setBankData({ ...bankData, bic: e.target.value })}
              />
              {bankError && <div className="error-message">{bankError}</div>}
              <div className="button-group">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setEditingBank(false);
                    setBankError('');
                    setBankData(bankSnapshot);
                  }}
                >
                  {t.auth.profile.cancel}
                </Button>
                <Button type="submit" variant="primary" disabled={savingBank}>
                  {t.auth.profile.save}
                </Button>
              </div>
            </form>
          ) : (
            <div className="profile-data">
              <p>
                <strong>{t.auth.register.iban}:</strong> {bankData.iban}
              </p>
              <p>
                <strong>{t.auth.register.bic}:</strong> {bankData.bic}
              </p>
            </div>
          )}
        </Card>

        <Card className="profile-section profile-section--account">
          <h2 className="h2">{t.auth.profile.accountTitle}</h2>
          {!showDeleteConfirm ? (
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(true)}>
              {t.auth.profile.deleteAccount}
            </Button>
          ) : (
            <form onSubmit={handleDeleteAccount}>
              <p>{t.auth.profile.deleteConfirm}</p>
              <Input
                label={t.auth.profile.confirmPassword}
                type="password"
                name="current-password"
                autoComplete="current-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {deleteError && <div className="error-message">{deleteError}</div>}
              <div className="button-group">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setConfirmPassword('');
                    setDeleteError('');
                  }}
                >
                  {t.auth.profile.cancel}
                </Button>
                <Button type="submit" variant="primary" disabled={deleting}>
                  {t.auth.profile.deleteAccount}
                </Button>
              </div>
            </form>
          )}
        </Card>
      </main>
      <Footer />
    </div>
  );
};
