/** English source of truth for Settings + shell chrome. */
export const EN = {
  'common.saveChanges': 'Save changes',
  'common.saved': 'Saved',
  'common.remove': 'Remove',
  'common.signOut': 'Sign out',
  'common.signingOut': 'Signing out…',
  'common.settings': 'Settings',
  'common.search': 'Search',
  'common.yes': 'Yes',
  'common.invite': 'Invite',

  'nav.primary': 'Primary',
  'nav.open': 'Open navigation',
  'nav.close': 'Close navigation',
  'nav.work': 'Work',
  'nav.system': 'System',
  'nav.startJob': 'Start a job',
  'nav.dashboard': 'Dashboard',
  'nav.settings': 'Settings',
  'nav.fieldCapture': 'Field capture',
  'nav.jumpTo': 'Jump to…',
  'nav.jumpToAria': 'Jump to a screen',
  'nav.accountMenu': 'Account menu',
  'nav.account': 'Account',
  'nav.appearance': 'Appearance: {theme}',
  'nav.switchToLight': 'Switch to light mode',
  'nav.switchToDark': 'Switch to dark mode',
  'nav.signOutConfirm': 'Sign out of Atmosphere?',
  'nav.themeModeHint': '{current} mode. Click for {next}.',

  'settings.title': 'Settings',
  'settings.sectionsAria': 'Settings sections',
  'settings.section.profile': 'Profile',
  'settings.section.profileBlurb': 'Your name and account details',
  'settings.section.security': 'Security',
  'settings.section.securityBlurb': 'Password and sign-out',
  'settings.section.organization': 'Organization',
  'settings.section.organizationBlurb': 'Team invites and linked accounts',
  'settings.section.billing': 'Billing',
  'settings.section.billingBlurb': 'Plan, tokens, and receipts',

  'settings.language.title': 'Language',
  'settings.language.description': 'Choose the language for Settings and navigation on this device.',
  'settings.language.helper':
    'More of the app will follow; Settings and navigation update first.',
  'settings.language.label': 'App language',
  'settings.language.search': 'Search languages',
  'settings.language.empty': 'No matching languages',
  'settings.language.aria': 'Choose app language',

  'settings.profile.title': 'Your profile',
  'settings.profile.description': 'This is how teammates see you in the linked accounts list.',
  'settings.profile.uploadAria': 'Upload a profile photo or icon',
  'settings.profile.changePhoto': 'Change photo',
  'settings.profile.uploadPhoto': 'Upload photo or icon',
  'settings.profile.displayName': 'Display name',
  'settings.profile.displayNameHint': 'Leave blank to fall back to your email address.',
  'settings.profile.saveError': 'Could not save your name. Try again.',
  'settings.profile.photoError': 'Could not update that photo.',
  'settings.profile.removePhotoError': 'Could not remove that photo.',

  'settings.account.title': 'Account',
  'settings.account.description': 'Details tied to your Atmosphere sign-in.',
  'settings.account.email': 'Email',
  'settings.account.emailConfirmed': 'Email confirmed',
  'settings.account.emailConfirmedYes': 'Yes',
  'settings.account.emailConfirmedNo': 'Not yet confirmed',
  'settings.account.memberSince': 'Member since',
  'settings.account.lastSignIn': 'Last sign-in',
  'settings.account.emailLocked':
    "Your sign-in email can't be changed here — it identifies your account across the organization.",

  'settings.password.title': 'Password',
  'settings.password.description':
    'Changing your password signs you out everywhere else. This device stays signed in.',
  'settings.password.current': 'Current password',
  'settings.password.new': 'New password',
  'settings.password.confirm': 'Confirm new password',
  'settings.password.hint': 'At least 8 characters.',
  'settings.password.mismatch': "Those passwords don't match yet.",
  'settings.password.update': 'Update password',
  'settings.password.updated': 'Password updated',
  'settings.password.show': 'Show passwords',
  'settings.password.hide': 'Hide passwords',
  'settings.password.error': 'Could not change your password. Try again.',

  'settings.signOut.title': 'Sign out',
  'settings.signOut.description':
    'Ends the session on this device. Sign in again with your email and password to continue.',

  'settings.linked.title': 'Linked accounts',
  'settings.linked.description':
    'Everyone whose login is linked to this office account can work in the same workspace.',
  'settings.linked.empty': 'No linked accounts yet. Invite teammates so they can link theirs.',
  'settings.linked.you': '(you)',
  'settings.linked.removeAria': 'Remove {name} from this workspace',
  'settings.linked.removeHint':
    'Remove unlinks their login from this office. Invite that address again if they should come back.',
  'settings.linked.removeError': 'Could not remove that person.',

  'settings.invites.title': 'Invite teammates',
  'settings.invites.adminOnly':
    'Only the Global Admin can invite people onto this workspace. Ask them to send an invite for your teammates.',
  'settings.invites.description':
    'Only you (Global Admin) can create workspace accounts for others. They open the invite email and create a login with that address. For a subcontractor on one job, invite them from the job file instead.',
  'settings.invites.button': 'Invite',
  'settings.invites.rolesHint': 'Global Admin can manage billing. Employees can do everything else.',

  'theme.light': 'Light',
  'theme.dark': 'Dark',

  'document.settings': 'Settings',
  'document.startJob': 'Start a job',
  'document.dashboard': 'Dashboard',
} as const;

export type MessageKey = keyof typeof EN;
export type MessageCatalog = Record<MessageKey, string>;
