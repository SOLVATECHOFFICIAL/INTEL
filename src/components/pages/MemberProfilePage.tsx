import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Crown,
  Edit3,
  GraduationCap,
  Loader2,
  MessageCircle,
  Package,
  Shield,
  ShieldAlert,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useFirebase } from '../../context/firebaseContext';
import {
  fetchFollowersListByUsername,
  fetchFollowingListByUsername,
  fetchMemberProfileBundleByUsername,
  followMemberByUsername,
  unfollowMemberByUsername,
  type MemberProfileBundle,
} from '../../services/firestoreFoundation';
import type { BadgeType, PublicProfileProjection } from '../../types/database';
import type { ActiveRoute, SearchScopeId } from '../../types/platform';
import { buildWhatsAppChatUrl } from '../../utils/authValidation';
import { GuestPromptCard } from '../auth/GuestPromptCard';

interface MemberProfilePageProps {
  username: string | null;
  onNavigate: (
    route: ActiveRoute,
    options?: { username?: string; searchScope?: SearchScopeId }
  ) => void;
  onRequireAuth: (authRoute: 'login' | 'register', returnTo: ActiveRoute) => void;
  onBack: () => void;
}

type ProfileTab = 'posts' | 'marketplace' | 'followers' | 'following';

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'LI';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const RoleBadgePill: React.FC<{ badge: BadgeType }> = ({ badge }) => {
  if (badge === 'supreme_admin') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-700 via-fuchsia-600 to-purple-800 px-2.5 py-1 text-xs font-bold text-white shadow-xs ring-1 ring-purple-300">
        <Crown className="h-3.5 w-3.5" aria-hidden="true" />
        Supreme Admin
      </span>
    );
  }
  if (badge === 'moderator') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white">
        <Shield className="h-3.5 w-3.5" aria-hidden="true" />
        Moderator
      </span>
    );
  }
  if (badge === 'verified') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
      Campus Member
    </span>
  );
};

export const MemberProfilePage: React.FC<MemberProfilePageProps> = ({
  username,
  onNavigate,
  onRequireAuth,
  onBack,
}) => {
  const { user, isSuspended, refreshAccountState } = useFirebase();

  const [bundle, setBundle] = useState<MemberProfileBundle | null>(null);
  const [loadState, setLoadState] = useState<
    'loading' | 'ready' | 'not_found' | 'error'
  >(() => (username ? 'loading' : 'not_found'));
  const [retryToken, setRetryToken] = useState(0);

  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  const [followersList, setFollowersList] = useState<PublicProfileProjection[]>(
    []
  );
  const [followingList, setFollowingList] = useState<PublicProfileProjection[]>(
    []
  );
  const [listLoading, setListLoading] = useState(false);

  const [isTogglingFollow, setIsTogglingFollow] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);

  useEffect(() => {
    if (!username) {
      return;
    }

    let active = true;

    fetchMemberProfileBundleByUsername(username, user?.uid ?? null)
      .then((result) => {
        if (!active) return;
        if (!result) {
          setBundle(null);
          setLoadState('not_found');
          return;
        }
        setBundle(result);
        setLoadState('ready');
      })
      .catch(() => {
        if (!active) return;
        setLoadState('error');
      });

    return () => {
      active = false;
    };
  }, [username, user?.uid, retryToken]);

  const handleSelectTab = (tab: ProfileTab) => {
    setActiveTab(tab);
    if (!bundle || (tab !== 'followers' && tab !== 'following')) {
      return;
    }

    setListLoading(true);
    const loader =
      tab === 'followers'
        ? fetchFollowersListByUsername(bundle.resolvedUsername)
        : fetchFollowingListByUsername(bundle.resolvedUsername);

    loader
      .then((items) => {
        if (tab === 'followers') {
          setFollowersList(items);
        } else {
          setFollowingList(items);
        }
      })
      .finally(() => {
        setListLoading(false);
      });
  };

  const handleToggleFollow = async () => {
    if (!bundle || isTogglingFollow) return;
    setActionError(null);

    if (!user) {
      setShowGuestPrompt(true);
      return;
    }
    if (isSuspended) {
      setActionError('Suspended accounts cannot follow or unfollow members.');
      return;
    }
    if (bundle.isOwnProfile) {
      return;
    }

    setIsTogglingFollow(true);
    const wasFollowing = bundle.isFollowing;

    try {
      if (wasFollowing) {
        await unfollowMemberByUsername(user.uid, bundle.resolvedUsername);
      } else {
        await followMemberByUsername(user.uid, bundle.resolvedUsername);
      }

      setBundle((prev) =>
        prev
          ? {
              ...prev,
              isFollowing: !wasFollowing,
              profile: {
                ...prev.profile,
                followersCount: Math.max(
                  0,
                  prev.profile.followersCount + (wasFollowing ? -1 : 1)
                ),
              },
            }
          : prev
      );
      await refreshAccountState();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Unable to update follow status right now.'
      );
    } finally {
      setIsTogglingFollow(false);
    }
  };

  if (loadState === 'loading') {
    return (
      <section className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="h-36 w-full animate-pulse rounded-xl bg-slate-200" />
        <div className="mt-4 h-7 w-52 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-36 animate-pulse rounded bg-slate-100" />
        <div className="mt-6 h-24 w-full animate-pulse rounded-xl bg-slate-100" />
      </section>
    );
  }

  if (loadState === 'error') {
    return (
      <section className="min-w-0 flex-1 rounded-2xl border border-red-200 bg-white p-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[42px] items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-[#0B1A2E]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        <h1 className="mt-4 font-display text-xl font-bold text-[#0B1A2E]">
          Unable to load member profile
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          A network or permission error occurred while loading this campus profile.
        </p>
        <button
          type="button"
          onClick={() => setRetryToken((prev) => prev + 1)}
          className="mt-4 inline-flex min-h-[42px] items-center rounded-lg bg-[#1E88E5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1565C0]"
        >
          Try Again
        </button>
      </section>
    );
  }

  if (loadState === 'not_found' || !bundle) {
    return (
      <section className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[42px] items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-[#0B1A2E]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        <div className="mt-6 max-w-md">
          <h1 className="font-display text-xl font-bold text-[#0B1A2E]">
            Member profile not found
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            No active public profile matches{' '}
            {username ? `@${username.toLowerCase()}` : 'this link'}. It may have
            been deleted or hidden from the directory.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onNavigate('for-you')}
              className="inline-flex min-h-[42px] items-center rounded-lg bg-[#0B1A2E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#132844]"
            >
              Return Home
            </button>
            <button
              type="button"
              onClick={() => onNavigate('search', { searchScope: 'home' })}
              className="inline-flex min-h-[42px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50"
            >
              Search Members
            </button>
          </div>
        </div>
      </section>
    );
  }

  const { profile } = bundle;
  const whatsappUrl = profile.publicWhatsapp
    ? buildWhatsAppChatUrl(profile.publicWhatsapp)
    : null;

  return (
    <section
      aria-labelledby="member-profile-heading"
      className="min-w-0 flex-1 space-y-5"
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-white hover:text-[#0B1A2E]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>

        {bundle.redirectedFrom && (
          <p className="text-xs text-slate-600">
            Updated handle: previously @{bundle.redirectedFrom}
          </p>
        )}
      </div>

      {/* Main Public Profile Card */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {/* Cover Photo */}
        <div className="relative h-36 w-full bg-gradient-to-r from-[#0B1A2E] via-[#122D4F] to-[#1E88E5] sm:h-44">
          {profile.coverUrl && (
            <img
              src={profile.coverUrl}
              alt={`${profile.fullName}'s cover banner`}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
        </div>

        <div className="px-5 pb-6 sm:px-6">
          {/* Avatar + Top CTA Row */}
          <div className="-mt-12 flex flex-col justify-between gap-4 sm:-mt-14 sm:flex-row sm:items-end">
            <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-[#0B1A2E] text-2xl font-bold text-white shadow-sm sm:h-28 sm:w-28">
              {profile.photoUrl ? (
                <img
                  src={profile.photoUrl}
                  alt={profile.fullName}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span>{getInitials(profile.fullName)}</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {bundle.isOwnProfile ? (
                <button
                  type="button"
                  onClick={() => onNavigate('account')}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50"
                >
                  <Edit3 className="h-4 w-4 text-[#1E88E5]" aria-hidden="true" />
                  Edit Profile Settings
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isTogglingFollow || bundle.isSuspended}
                  onClick={() => void handleToggleFollow()}
                  className={`inline-flex min-h-[42px] items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
                    bundle.isFollowing
                      ? 'border border-slate-300 bg-white text-[#0B1A2E] hover:bg-slate-50'
                      : 'bg-[#1E88E5] text-white hover:bg-[#1565C0]'
                  }`}
                >
                  {isTogglingFollow ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : bundle.isFollowing ? (
                    <UserCheck
                      className="h-4 w-4 text-[#1E88E5]"
                      aria-hidden="true"
                    />
                  ) : (
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>{bundle.isFollowing ? 'Following' : 'Follow'}</span>
                </button>
              )}

              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#0B1A2E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#132844]"
                >
                  <MessageCircle
                    className="h-4 w-4 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  <span>Message on WhatsApp</span>
                </a>
              )}
            </div>
          </div>

          {/* Member Identity & Badges */}
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1
                id="member-profile-heading"
                className="font-display text-2xl font-bold text-[#0B1A2E]"
              >
                {profile.fullName}
              </h1>
              <RoleBadgePill badge={profile.badge} />
              {bundle.isSuspended && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  Suspended
                </span>
              )}
            </div>

            <p className="mt-0.5 text-sm font-medium text-slate-600">
              @{profile.username}
            </p>

            {profile.bio?.trim() && (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-700">
                {profile.bio}
              </p>
            )}

            {/* Academic / Campus Metadata */}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-600 sm:text-sm">
              {profile.level && (
                <span className="inline-flex items-center gap-1.5">
                  <GraduationCap
                    className="h-4 w-4 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  {profile.level}
                </span>
              )}
              {profile.department && (
                <span className="inline-flex items-center gap-1.5">
                  <Building2
                    className="h-4 w-4 text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  {profile.department}
                </span>
              )}
              {profile.faculty?.trim() && (
                <span className="text-slate-600">
                  Faculty: {profile.faculty}
                </span>
              )}
            </div>

            {/* Follower / Following Counts */}
            <div className="mt-4 flex flex-wrap items-center gap-5 border-t border-slate-100 pt-4 text-sm">
              <button
                type="button"
                onClick={() => handleSelectTab('followers')}
                className="inline-flex items-center gap-1.5 font-medium text-[#0B1A2E] hover:text-[#1E88E5]"
              >
                <span className="font-bold tabular-nums">
                  {profile.followersCount}
                </span>
                <span className="text-slate-600">Followers</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectTab('following')}
                className="inline-flex items-center gap-1.5 font-medium text-[#0B1A2E] hover:text-[#1E88E5]"
              >
                <span className="font-bold tabular-nums">
                  {profile.followingCount}
                </span>
                <span className="text-slate-600">Following</span>
              </button>
            </div>
          </div>

          {actionError && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              {actionError}
            </div>
          )}

          {showGuestPrompt && (
            <div className="mt-4">
              <GuestPromptCard
                title={`Sign in to follow @${profile.username}`}
                description="Guests can view public member profiles and open WhatsApp conversations. Sign in to follow members and build your Following feed."
                returnRoute="for-you"
                onRequireAuth={onRequireAuth}
                onDismiss={() => setShowGuestPrompt(false)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Profile Content Tabs */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div
          role="tablist"
          aria-label="Member profile tabs"
          className="grid grid-cols-4 border-b border-slate-200"
        >
          {(
            [
              { id: 'posts', label: `Posts (${bundle.posts.length})` },
              {
                id: 'marketplace',
                label: `Listings (${bundle.listings.length})`,
              },
              {
                id: 'followers',
                label: `Followers (${profile.followersCount})`,
              },
              {
                id: 'following',
                label: `Following (${profile.followingCount})`,
              },
            ] as { id: ProfileTab; label: string }[]
          ).map((tab) => {
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => handleSelectTab(tab.id)}
                className={`relative min-h-[46px] px-2 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors sm:text-sm ${
                  isSelected
                    ? 'text-[#1E88E5]'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-[#0B1A2E]'
                }`}
              >
                {tab.label}
                {isSelected && (
                  <span
                    aria-hidden="true"
                    className="absolute right-3 bottom-0 left-3 h-0.5 rounded-full bg-[#1E88E5]"
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="p-5 sm:p-6">
          {activeTab === 'posts' && (
            <div className="space-y-4">
              {!bundle.canPublishOrdinaryPosts ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  Ordinary community feed updates are reserved for Verified
                  members, Moderators, and Administrators. Anonymous campus
                  activity never appears on member profiles.
                </div>
              ) : bundle.posts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-600">
                  No published public posts from @{profile.username} yet.
                </div>
              ) : (
                bundle.posts.map((post) => (
                  <article
                    key={post.id}
                    className="rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>{post.category}</span>
                      <span>
                        {post.isOfficial ? 'Official Update' : 'Public Post'}
                      </span>
                    </div>
                    {post.title && (
                      <h2 className="mt-1.5 font-display text-base font-bold text-[#0B1A2E]">
                        {post.title}
                      </h2>
                    )}
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                      {post.body}
                    </p>
                  </article>
                ))
              )}
            </div>
          )}

          {activeTab === 'marketplace' && (
            <div className="space-y-3">
              {bundle.listings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-600">
                  <Package
                    className="mx-auto mb-2 h-5 w-5 text-slate-400"
                    aria-hidden="true"
                  />
                  No active marketplace listings for @{profile.username}.
                </div>
              ) : (
                bundle.listings.map((item) => (
                  <article
                    key={item.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center"
                  >
                    <div>
                      <p className="text-xs font-medium text-slate-500">
                        {item.listingKind} · {item.category}
                      </p>
                      <h2 className="mt-0.5 font-display text-base font-bold text-[#0B1A2E]">
                        {item.title}
                      </h2>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                        {item.description}
                      </p>
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <p className="font-display text-lg font-bold text-[#0B1A2E] tabular-nums">
                        ₦{item.price.toLocaleString()}
                      </p>
                      {buildWhatsAppChatUrl(item.whatsappNumber) && (
                        <a
                          href={buildWhatsAppChatUrl(item.whatsappNumber)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1A2E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#132844]"
                        >
                          <MessageCircle
                            className="h-3.5 w-3.5 text-[#1E88E5]"
                            aria-hidden="true"
                          />
                          Contact Seller
                        </a>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          )}

          {(activeTab === 'followers' || activeTab === 'following') && (
            <div>
              {listLoading ? (
                <div className="flex items-center justify-center py-8 text-sm text-slate-600">
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
                    aria-hidden="true"
                  />
                  Loading {activeTab}...
                </div>
              ) : (activeTab === 'followers' ? followersList : followingList)
                  .length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-600">
                  <Users
                    className="mx-auto mb-2 h-5 w-5 text-slate-400"
                    aria-hidden="true"
                  />
                  {activeTab === 'followers'
                    ? `@${profile.username} does not have any followers yet.`
                    : `@${profile.username} is not following anyone yet.`}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(activeTab === 'followers'
                    ? followersList
                    : followingList
                  ).map((member) => (
                    <button
                      key={member.username}
                      type="button"
                      onClick={() =>
                        onNavigate('profile', { username: member.username })
                      }
                      className="flex min-h-[64px] items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-[#1E88E5] hover:bg-slate-50"
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#0B1A2E] text-xs font-bold text-white">
                        {member.photoUrl ? (
                          <img
                            src={member.photoUrl}
                            alt={member.fullName}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span>{getInitials(member.fullName)}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-sm font-bold text-[#0B1A2E]">
                          {member.fullName}
                        </p>
                        <p className="truncate text-xs text-slate-600">
                          @{member.username}
                          {member.department ? ` · ${member.department}` : ''}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
