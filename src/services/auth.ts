import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
  verifyBeforeUpdateEmail,
  type Unsubscribe,
  type User,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

export interface AuthAccountSummary {
  isSignedIn: boolean;
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  providerIds: string[];
}

export function getAuthAccountSummary(user: User | null): AuthAccountSummary {
  if (!user) {
    return {
      isSignedIn: false,
      uid: null,
      email: null,
      emailVerified: false,
      displayName: null,
      providerIds: [],
    };
  }

  return {
    isSignedIn: true,
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    providerIds: user.providerData.map((item) => item.providerId),
  };
}

/**
 * Requires Email/Password provider to be enabled in Firebase Console
 * (Authentication -> Sign-in method -> Email/Password).
 */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<User> {
  const normalizedEmail = email.trim();
  const credential = await signInWithEmailAndPassword(
    auth,
    normalizedEmail,
    password
  );
  return credential.user;
}

export async function registerWithEmail(
  email: string,
  password: string,
  fullName?: string
): Promise<User> {
  const normalizedEmail = email.trim();
  const credential = await createUserWithEmailAndPassword(
    auth,
    normalizedEmail,
    password
  );

  if (fullName && fullName.trim().length >= 2) {
    try {
      await updateProfile(credential.user, {
        displayName: fullName.trim().slice(0, 100),
      });
    } catch {
      // Non-fatal: full name is also persisted in Firestore user profile.
    }
  }

  try {
    await sendEmailVerification(credential.user);
  } catch {
    // Non-fatal: user can request verification again from Account Settings.
  }

  return credential.user;
}

export async function requestEmailVerification(user: User): Promise<void> {
  await sendEmailVerification(user);
}

export async function sendPasswordRecoveryEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function reauthenticateCurrentUser(
  user: User,
  currentPassword: string
): Promise<void> {
  if (!user.email) {
    throw new Error('This account does not have a verified sign-in email.');
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
}

export async function changeAccountPassword(
  user: User,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await reauthenticateCurrentUser(user, currentPassword);
  await updatePassword(user, newPassword);
}

export async function requestAccountEmailChange(
  user: User,
  currentPassword: string,
  newEmail: string
): Promise<void> {
  await reauthenticateCurrentUser(user, currentPassword);
  await verifyBeforeUpdateEmail(user, newEmail.trim());
}

export async function deleteAuthenticatedUser(user: User): Promise<void> {
  await deleteUser(user);
}

export async function signOutCurrentUser(): Promise<void> {
  await signOut(auth);
}

export function subscribeToAuthChanges(
  onUserChange: (user: User | null) => void
): Unsubscribe {
  return onAuthStateChanged(auth, onUserChange);
}
