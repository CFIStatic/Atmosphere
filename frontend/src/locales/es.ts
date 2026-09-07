import type { MessageCatalog } from './en';

/** Full Spanish catalog for Settings + shell chrome. */
export const ES: MessageCatalog = {
  'common.saveChanges': 'Guardar cambios',
  'common.saved': 'Guardado',
  'common.remove': 'Quitar',
  'common.signOut': 'Cerrar sesión',
  'common.signingOut': 'Cerrando sesión…',
  'common.settings': 'Ajustes',
  'common.search': 'Buscar',
  'common.yes': 'Sí',
  'common.invite': 'Invitar',

  'nav.primary': 'Principal',
  'nav.open': 'Abrir navegación',
  'nav.close': 'Cerrar navegación',
  'nav.work': 'Trabajo',
  'nav.system': 'Sistema',
  'nav.startJob': 'Empezar un trabajo',
  'nav.dashboard': 'Panel',
  'nav.settings': 'Ajustes',
  'nav.fieldCapture': 'Captura de campo',
  'nav.jumpTo': 'Ir a…',
  'nav.jumpToAria': 'Ir a una pantalla',
  'nav.accountMenu': 'Menú de la cuenta',
  'nav.account': 'Cuenta',
  'nav.appearance': 'Apariencia: {theme}',
  'nav.switchToLight': 'Cambiar a modo claro',
  'nav.switchToDark': 'Cambiar a modo oscuro',
  'nav.signOutConfirm': '¿Cerrar sesión en Atmosphere?',
  'nav.themeModeHint': 'Modo {current}. Clic para {next}.',

  'settings.title': 'Ajustes',
  'settings.sectionsAria': 'Secciones de ajustes',
  'settings.section.profile': 'Perfil',
  'settings.section.profileBlurb': 'Tu nombre y los datos de la cuenta',
  'settings.section.security': 'Seguridad',
  'settings.section.securityBlurb': 'Contraseña y cierre de sesión',
  'settings.section.organization': 'Organización',
  'settings.section.organizationBlurb': 'Invitaciones y cuentas vinculadas',
  'settings.section.billing': 'Facturación',
  'settings.section.billingBlurb': 'Plan, tokens y recibos',

  'settings.language.title': 'Idioma',
  'settings.language.description':
    'Elige el idioma de Ajustes y la navegación en este dispositivo.',
  'settings.language.helper':
    'El resto de la aplicación llegará después; Ajustes y la navegación se actualizan primero.',
  'settings.language.label': 'Idioma de la aplicación',
  'settings.language.search': 'Buscar idiomas',
  'settings.language.empty': 'No hay idiomas que coincidan',
  'settings.language.aria': 'Elegir el idioma de la aplicación',

  'settings.profile.title': 'Tu perfil',
  'settings.profile.description': 'Así te ven tus compañeros en la lista de cuentas vinculadas.',
  'settings.profile.uploadAria': 'Subir una foto o un icono de perfil',
  'settings.profile.changePhoto': 'Cambiar foto',
  'settings.profile.uploadPhoto': 'Subir foto o icono',
  'settings.profile.displayName': 'Nombre visible',
  'settings.profile.displayNameHint': 'Déjalo en blanco para usar tu correo.',
  'settings.profile.saveError': 'No se pudo guardar tu nombre. Inténtalo de nuevo.',
  'settings.profile.photoError': 'No se pudo actualizar esa foto.',
  'settings.profile.removePhotoError': 'No se pudo quitar esa foto.',

  'settings.account.title': 'Cuenta',
  'settings.account.description': 'Datos ligados a tu inicio de sesión en Atmosphere.',
  'settings.account.email': 'Correo',
  'settings.account.emailConfirmed': 'Correo confirmado',
  'settings.account.emailConfirmedYes': 'Sí',
  'settings.account.emailConfirmedNo': 'Aún no confirmado',
  'settings.account.memberSince': 'Miembro desde',
  'settings.account.lastSignIn': 'Último acceso',
  'settings.account.emailLocked':
    'El correo de acceso no se puede cambiar aquí: identifica tu cuenta en la organización.',

  'settings.password.title': 'Contraseña',
  'settings.password.description':
    'Al cambiar la contraseña se cierra la sesión en los demás dispositivos. Este se mantiene.',
  'settings.password.current': 'Contraseña actual',
  'settings.password.new': 'Nueva contraseña',
  'settings.password.confirm': 'Confirmar nueva contraseña',
  'settings.password.hint': 'Al menos 8 caracteres.',
  'settings.password.mismatch': 'Esas contraseñas aún no coinciden.',
  'settings.password.update': 'Actualizar contraseña',
  'settings.password.updated': 'Contraseña actualizada',
  'settings.password.show': 'Mostrar contraseñas',
  'settings.password.hide': 'Ocultar contraseñas',
  'settings.password.error': 'No se pudo cambiar la contraseña. Inténtalo de nuevo.',

  'settings.signOut.title': 'Cerrar sesión',
  'settings.signOut.description':
    'Termina la sesión en este dispositivo. Vuelve a entrar con tu correo y contraseña.',

  'settings.linked.title': 'Cuentas vinculadas',
  'settings.linked.description':
    'Quienes tienen el acceso vinculado a esta oficina trabajan en el mismo espacio.',
  'settings.linked.empty':
    'Aún no hay cuentas vinculadas. Invita a tus compañeros para que vinculen las suyas.',
  'settings.linked.you': '(tú)',
  'settings.linked.removeAria': 'Quitar a {name} de este espacio de trabajo',
  'settings.linked.removeHint':
    'Quitar desvincula su acceso de esta oficina. Vuelve a invitar esa dirección si debe regresar.',
  'settings.linked.removeError': 'No se pudo quitar a esa persona.',

  'settings.invites.title': 'Invitar compañeros',
  'settings.invites.adminOnly':
    'Solo el administrador global puede invitar a este espacio. Pídele que envíe una invitación.',
  'settings.invites.description':
    'Solo tú (administrador global) puedes crear cuentas de espacio para otros. Abren el correo de invitación y crean un acceso con esa dirección. Para un subcontratista en un solo trabajo, invítalo desde el archivo del trabajo.',
  'settings.invites.button': 'Invitar',
  'settings.invites.rolesHint':
    'El administrador global gestiona la facturación. Los empleados pueden hacer el resto.',

  'theme.light': 'Claro',
  'theme.dark': 'Oscuro',

  'document.settings': 'Ajustes',
  'document.startJob': 'Empezar un trabajo',
  'document.dashboard': 'Panel',
};
