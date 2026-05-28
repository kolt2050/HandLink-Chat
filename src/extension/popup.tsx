import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { mailboxKeyFromInvite, createInvite, parseInvite } from '../core/invite'
import { db } from '../core/storage'
import { TrackerChatSession, type ChatImageAttachment, type ChatMessage, type ChatPeer } from '../core/trackerChat'
import type { StoredChatMessage } from '../types'
import './popup.css'

interface LogLine {
  id: string
  timestamp: number
  message: string
}

interface InviteOfferBundle {
  invite: string
  signal: string
  chatName?: string
  peerName?: string
}

interface RuntimeProfile {
  nickname: string
  chatName: string
  localPeerId: string
  locale: Locale
}

interface RuntimeSnapshot {
  invite: string
  joinInvite: string
  chatName: string
  mailboxKey: string
  logs: LogLine[]
  chatStatus: string
  chatMessages: ChatMessage[]
  connectedPeers: ChatPeer[]
  manualSignalOut: string
  unreadMentionIds: string[]
}

type RuntimeCommand =
  | { type: 'snapshot'; profile?: RuntimeProfile }
  | { type: 'profile'; profile: RuntimeProfile }
  | { type: 'createInviteOffer'; mode: 'new' | 'current'; profile: RuntimeProfile }
  | { type: 'acceptSignal'; signal: string; profile: RuntimeProfile }
  | { type: 'sendMessage'; text: string; image?: ChatImageAttachment; mentionPeerIds?: string[]; profile: RuntimeProfile }
  | { type: 'markMentionRead'; messageId: string }
  | { type: 'disconnect' }

type Locale = 'ru' | 'en' | 'fr' | 'de' | 'es-ES' | 'zh-CN' | 'ja' | 'ko' | 'pt-BR' | 'zh-TW' | 'pl'
type Theme = 'light' | 'dark'

const CHAT_MESSAGE_LIMIT = 1000
const IMAGE_MAX_EDGE = 1280
const IMAGE_MAX_DATA_URL_BYTES = Math.floor(1.5 * 1024 * 1024)
const IMAGE_OUTPUT_TYPE = 'image/webp'
const IMAGE_OUTPUT_QUALITY = 0.82
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const LOCALE_STORAGE_KEY = 'handlink-chat:locale'
const THEME_STORAGE_KEY = 'handlink-chat:theme'
const PEER_ID_STORAGE_KEY = 'handlink-chat:peerId'

const localeOptions: Array<{ value: Locale; label: string }> = [
  { value: 'ru', label: 'русский' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es-ES', label: 'español - España' },
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'pt-BR', label: 'português - Brasil' },
  { value: 'zh-TW', label: '中文（繁體）' },
  { value: 'pl', label: 'polski' }
]

const translations: Record<Locale, {
  subtitle: string
  theme: string
  light: string
  dark: string
  language: string
  nickname: string
  nicknamePlaceholder: string
  chatName: string
  chatNamePlaceholder: string
  newChatOffer: string
  inviteToCurrent: string
  connectionSetup: string
  setupReadyToSend: string
  setupReadyToAccept: string
  setupIdle: string
  sendToUser: string
  sendPlaceholder: string
  pasteReply: string
  pastePlaceholder: string
  accept: string
  chatFallback: string
  disconnect: string
  disconnectConfirm: string
  typeMessage: string
  send: string
  attachImage: string
  removeImage: string
  imageUnsupported: string
  imageTooLarge: string
  imageProcessingFailed: string
  liveLogs: string
  noLogs: string
  noMessages: string
  connectedUsers: string
  noConnectedUsers: string
  reply: string
  statusDisconnected: string
  statusConnected: string
  statusManualFailed: string
  statusConnecting: string
  statusOpen: string
  statusClosed: string
  statusEnterNickname: string
  statusEnterChatName: string
  logInviteNicknameRequired: string
  logInviteChatNameRequired: string
  logCreateNewChat: string
  logCreateInviteExisting: string
  logInviteCreated: string
  logInviteFailed: string
  logPasteRequired: string
  logAnswerNeedsInvite: string
  logAnswerCreated: string
  logManualFailed: string
  logSendNeedsInvite: string
  logMessageSaved: string
  logSendFailed: string
  logChatStopped: string
  logLoaded: string
  logPruned: string
  logHistoryCleared: string
  systemInvited: string
  logRestored: string
  logSessionPrepared: string
}> = {
  en: {
    subtitle: 'Multi-user P2P chat with local encrypted history.',
    theme: 'Theme', light: 'Light', dark: 'Dark', language: 'Language',
    nickname: 'Nickname *', nicknamePlaceholder: 'Required before creating invite',
    chatName: 'Chat Name *', chatNamePlaceholder: 'Room name visible to everyone',
    newChatOffer: 'New Chat + Offer', inviteToCurrent: 'Invite User',
    connectionSetup: 'Connection Setup', setupReadyToSend: 'ready to send', setupReadyToAccept: 'ready to accept', setupIdle: 'manual invite exchange',
    sendToUser: '1. Send to another user', sendPlaceholder: 'Key to send to another user',
    pasteReply: '2. Paste reply or invite', pastePlaceholder: 'Paste another user key here',
    accept: 'Accept', chatFallback: 'Chat', disconnect: 'Disconnect', disconnectConfirm: 'Leave the chat? Local messages for this room will be cleared.', typeMessage: 'Type a message', send: 'Send',
    attachImage: 'Attach image', removeImage: 'Remove image', imageUnsupported: 'Only PNG, JPEG, and WebP images are supported.', imageTooLarge: 'Image is too large after compression.', imageProcessingFailed: 'Could not prepare the image.',
    liveLogs: 'Live Logs', noLogs: 'No logs yet.', noMessages: 'No chat messages yet.',
    connectedUsers: 'Connected users', noConnectedUsers: 'No connected users', reply: 'Reply',
    statusDisconnected: 'disconnected', statusConnected: 'connected', statusManualFailed: 'manual failed', statusConnecting: 'connecting', statusOpen: 'open', statusClosed: 'closed',
    statusEnterNickname: 'Enter a nickname before creating an invite.', statusEnterChatName: 'Enter a chat name before creating an invite.',
    logInviteNicknameRequired: 'Invite + offer blocked: nickname is required.', logInviteChatNameRequired: 'Invite + offer blocked: chat name is required.',
    logCreateNewChat: 'Creating new chat and manual WebRTC offer bundle for "{name}".', logCreateInviteExisting: 'Creating invite offer for existing chat "{name}".',
    logInviteCreated: 'Invite + offer bundle created. Send this single text to the other user.', logInviteFailed: 'Invite + offer failed: {error}',
    logPasteRequired: 'Manual signal failed: paste invite+offer or answer first.', logAnswerNeedsInvite: 'Manual signal failed: this answer does not contain an invite, so the original invite is required.',
    logAnswerCreated: 'Answer bundle created. Send it back to the first user.', logManualFailed: 'Manual signal failed: {error}',
    logSendNeedsInvite: 'Send failed: generate or paste an invite first.', logMessageSaved: 'Message saved locally and will sync when a peer connects.', logSendFailed: 'Send failed: {error}',
    logChatStopped: 'Chat stopped.', logLoaded: 'Loaded {count} saved chat message(s).', logPruned: 'Pruned {count} old chat message(s); keeping latest {limit}.',
    logHistoryCleared: 'Cleared {count} local chat message(s) for this room.',
    systemInvited: '{inviter} invited {invitee} to the chat.',
    logRestored: 'Last room restored after page load.', logSessionPrepared: 'Manual WebRTC signaling session prepared.'
  },
  ru: {
    subtitle: 'Многопользовательский P2P-чат с локальной зашифрованной историей.',
    theme: 'Тема', light: 'Светлая', dark: 'Тёмная', language: 'Язык',
    nickname: 'Никнейм *', nicknamePlaceholder: 'Нужен перед созданием приглашения',
    chatName: 'Название чата *', chatNamePlaceholder: 'Название комнаты видно всем',
    newChatOffer: 'Новый чат + offer', inviteToCurrent: 'Пригласить пользователя',
    connectionSetup: 'Подключение', setupReadyToSend: 'готово к отправке', setupReadyToAccept: 'готово к принятию', setupIdle: 'ручной обмен приглашением',
    sendToUser: '1. Отправить другому пользователю', sendPlaceholder: 'ключ для отправки другому пользователю',
    pasteReply: '2. Вставить ответ или приглашение', pastePlaceholder: 'вставьте сюда ключ другого пользователя',
    accept: 'Принять', chatFallback: 'Чат', disconnect: 'Отключиться', disconnectConfirm: 'Точно выйти из чата? Локальные сообщения этой комнаты будут удалены.', typeMessage: 'Введите сообщение', send: 'Отправить',
    attachImage: 'Прикрепить картинку', removeImage: 'Убрать картинку', imageUnsupported: 'Поддерживаются только PNG, JPEG и WebP.', imageTooLarge: 'Картинка слишком большая после сжатия.', imageProcessingFailed: 'Не удалось подготовить картинку.',
    liveLogs: 'Живые логи', noLogs: 'Логов пока нет.', noMessages: 'Сообщений пока нет.',
    connectedUsers: 'Подключённые пользователи', noConnectedUsers: 'Нет подключённых пользователей', reply: 'Ответить',
    statusDisconnected: 'отключено', statusConnected: 'подключено', statusManualFailed: 'ошибка подключения', statusConnecting: 'подключение', statusOpen: 'открыто', statusClosed: 'закрыто',
    statusEnterNickname: 'Введите никнейм перед созданием приглашения.', statusEnterChatName: 'Введите название чата перед созданием приглашения.',
    logInviteNicknameRequired: 'Создание invite + offer остановлено: нужен никнейм.', logInviteChatNameRequired: 'Создание invite + offer остановлено: нужно название чата.',
    logCreateNewChat: 'Создаю новый чат и WebRTC offer для "{name}".', logCreateInviteExisting: 'Создаю приглашение в существующий чат "{name}".',
    logInviteCreated: 'Invite + offer создан. Отправьте этот один текст другому пользователю.', logInviteFailed: 'Не удалось создать invite + offer: {error}',
    logPasteRequired: 'Ошибка сигнала: сначала вставьте invite+offer или answer.', logAnswerNeedsInvite: 'Ошибка сигнала: этот answer не содержит invite, нужен исходный invite.',
    logAnswerCreated: 'Answer создан. Отправьте его обратно первому пользователю.', logManualFailed: 'Ошибка ручного сигнала: {error}',
    logSendNeedsInvite: 'Отправка не удалась: сначала создайте или вставьте invite.', logMessageSaved: 'Сообщение сохранено локально и синхронизируется при подключении peer.', logSendFailed: 'Отправка не удалась: {error}',
    logChatStopped: 'Чат остановлен.', logLoaded: 'Загружено сохранённых сообщений: {count}.', logPruned: 'Удалено старых сообщений: {count}; оставлены последние {limit}.',
    logHistoryCleared: 'Локальные сообщения этой комнаты удалены: {count}.',
    systemInvited: '{inviter} пригласил(а) в чат пользователя {invitee}.',
    logRestored: 'Последняя комната восстановлена после загрузки страницы.', logSessionPrepared: 'Ручная WebRTC signaling-сессия подготовлена.'
  },
  fr: {
    subtitle: 'Chat P2P multi-utilisateur avec historique chiffré local.', theme: 'Thème', light: 'Clair', dark: 'Sombre', language: 'Langue',
    nickname: 'Pseudo *', nicknamePlaceholder: 'Requis avant de créer une invitation', chatName: 'Nom du chat *', chatNamePlaceholder: 'Nom visible par tout le monde',
    newChatOffer: 'Nouveau chat + offer', inviteToCurrent: 'Inviter un utilisateur', connectionSetup: 'Connexion', setupReadyToSend: 'prêt à envoyer', setupReadyToAccept: 'prêt à accepter', setupIdle: 'échange manuel d’invitation',
    sendToUser: '1. Envoyer à un autre utilisateur', sendPlaceholder: 'Clé à envoyer à un autre utilisateur',
    pasteReply: '2. Coller une réponse ou invitation', pastePlaceholder: 'Collez ici la clé d’un autre utilisateur',
    accept: 'Accepter', chatFallback: 'Chat', disconnect: 'Déconnecter', disconnectConfirm: 'Quitter le chat ? Les messages locaux de cette salle seront supprimés.', typeMessage: 'Écrire un message', send: 'Envoyer', attachImage: 'Joindre une image', removeImage: 'Retirer l’image', imageUnsupported: 'Seules les images PNG, JPEG et WebP sont prises en charge.', imageTooLarge: 'L’image est trop grande après compression.', imageProcessingFailed: 'Impossible de préparer l’image.', liveLogs: 'Logs en direct', noLogs: 'Aucun log.', noMessages: 'Aucun message.', connectedUsers: 'Utilisateurs connectés', noConnectedUsers: 'Aucun utilisateur connecté', reply: 'Répondre',
    statusDisconnected: 'déconnecté', statusConnected: 'connecté', statusManualFailed: 'échec manuel', statusConnecting: 'connexion', statusOpen: 'ouvert', statusClosed: 'fermé',
    statusEnterNickname: 'Saisissez un pseudo avant de créer une invitation.', statusEnterChatName: 'Saisissez un nom de chat avant de créer une invitation.',
    logInviteNicknameRequired: 'Invite + offer bloqué : pseudo requis.', logInviteChatNameRequired: 'Invite + offer bloqué : nom du chat requis.', logCreateNewChat: 'Création du chat et de l’offer WebRTC pour "{name}".',
    logCreateInviteExisting: 'Création d’une invitation pour le chat "{name}".', logInviteCreated: 'Invite + offer créé. Envoyez ce texte à l’autre utilisateur.', logInviteFailed: 'Échec invite + offer : {error}',
    logPasteRequired: 'Signal manuel échoué : collez invite+offer ou answer.', logAnswerNeedsInvite: 'Signal manuel échoué : cette answer ne contient pas d’invite.', logAnswerCreated: 'Answer créée. Renvoyez-la au premier utilisateur.',
    logManualFailed: 'Signal manuel échoué : {error}', logSendNeedsInvite: 'Envoi échoué : créez ou collez une invitation.', logMessageSaved: 'Message enregistré localement et synchronisé quand un peer se connecte.', logSendFailed: 'Envoi échoué : {error}',
    logChatStopped: 'Chat arrêté.', logLoaded: '{count} message(s) chargé(s).', logPruned: '{count} ancien(s) message(s) supprimé(s); {limit} conservés.', logRestored: 'Dernière salle restaurée.', logSessionPrepared: 'Session WebRTC manuelle prête.'
    , logHistoryCleared: '{count} message(s) local(aux) supprimé(s) pour cette salle.', systemInvited: '{inviter} a invité {invitee} dans le chat.'
  },
  de: {
    subtitle: 'Mehrbenutzer-P2P-Chat mit lokal verschlüsseltem Verlauf.', theme: 'Design', light: 'Hell', dark: 'Dunkel', language: 'Sprache',
    nickname: 'Nickname *', nicknamePlaceholder: 'Vor dem Erstellen einer Einladung erforderlich', chatName: 'Chatname *', chatNamePlaceholder: 'Raumname ist für alle sichtbar',
    newChatOffer: 'Neuer Chat + Offer', inviteToCurrent: 'Nutzer einladen', connectionSetup: 'Verbindung', setupReadyToSend: 'bereit zum Senden', setupReadyToAccept: 'bereit zum Annehmen', setupIdle: 'manueller Einladungsaustausch',
    sendToUser: '1. An anderen Nutzer senden', sendPlaceholder: 'Schlüssel zum Senden an einen anderen Nutzer',
    pasteReply: '2. Antwort oder Einladung einfügen', pastePlaceholder: 'Schlüssel eines anderen Nutzers hier einfügen',
    accept: 'Annehmen', chatFallback: 'Chat', disconnect: 'Trennen', disconnectConfirm: 'Chat verlassen? Lokale Nachrichten dieses Raums werden gelöscht.', typeMessage: 'Nachricht eingeben', send: 'Senden', attachImage: 'Bild anhängen', removeImage: 'Bild entfernen', imageUnsupported: 'Nur PNG-, JPEG- und WebP-Bilder werden unterstützt.', imageTooLarge: 'Das Bild ist nach der Komprimierung zu groß.', imageProcessingFailed: 'Das Bild konnte nicht vorbereitet werden.', liveLogs: 'Live-Logs', noLogs: 'Noch keine Logs.', noMessages: 'Noch keine Nachrichten.', connectedUsers: 'Verbundene Nutzer', noConnectedUsers: 'Keine verbundenen Nutzer', reply: 'Antworten',
    statusDisconnected: 'getrennt', statusConnected: 'verbunden', statusManualFailed: 'manuell fehlgeschlagen', statusConnecting: 'verbindet', statusOpen: 'offen', statusClosed: 'geschlossen',
    statusEnterNickname: 'Nickname vor dem Erstellen der Einladung eingeben.', statusEnterChatName: 'Chatnamen vor dem Erstellen der Einladung eingeben.',
    logInviteNicknameRequired: 'Invite + offer blockiert: Nickname erforderlich.', logInviteChatNameRequired: 'Invite + offer blockiert: Chatname erforderlich.', logCreateNewChat: 'Erstelle neuen Chat und WebRTC offer für "{name}".',
    logCreateInviteExisting: 'Erstelle Einladung für bestehenden Chat "{name}".', logInviteCreated: 'Invite + offer erstellt. Diesen Text senden.', logInviteFailed: 'Invite + offer fehlgeschlagen: {error}',
    logPasteRequired: 'Manuelles Signal fehlgeschlagen: invite+offer oder answer einfügen.', logAnswerNeedsInvite: 'Diese answer enthält keine invite.', logAnswerCreated: 'Answer erstellt. Zurücksenden.',
    logManualFailed: 'Manuelles Signal fehlgeschlagen: {error}', logSendNeedsInvite: 'Senden fehlgeschlagen: erst invite erstellen oder einfügen.', logMessageSaved: 'Nachricht lokal gespeichert und wird bei Verbindung synchronisiert.', logSendFailed: 'Senden fehlgeschlagen: {error}',
    logChatStopped: 'Chat gestoppt.', logLoaded: '{count} gespeicherte Nachricht(en) geladen.', logPruned: '{count} alte Nachricht(en) entfernt; neueste {limit} behalten.', logRestored: 'Letzter Raum wiederhergestellt.', logSessionPrepared: 'Manuelle WebRTC-Signaling-Sitzung bereit.'
    , logHistoryCleared: '{count} lokale Nachricht(en) für diesen Raum gelöscht.', systemInvited: '{inviter} hat {invitee} in den Chat eingeladen.'
  },
  'es-ES': {
    subtitle: 'Chat P2P multiusuario con historial cifrado local.', theme: 'Tema', light: 'Claro', dark: 'Oscuro', language: 'Idioma',
    nickname: 'Apodo *', nicknamePlaceholder: 'Necesario antes de crear una invitación', chatName: 'Nombre del chat *', chatNamePlaceholder: 'Nombre visible para todos',
    newChatOffer: 'Nuevo chat + offer', inviteToCurrent: 'Invitar usuario', connectionSetup: 'Conexión', setupReadyToSend: 'listo para enviar', setupReadyToAccept: 'listo para aceptar', setupIdle: 'intercambio manual de invitación',
    sendToUser: '1. Enviar a otro usuario', sendPlaceholder: 'Clave para enviar a otro usuario',
    pasteReply: '2. Pegar respuesta o invitación', pastePlaceholder: 'Pega aquí la clave de otro usuario',
    accept: 'Aceptar', chatFallback: 'Chat', disconnect: 'Desconectar', disconnectConfirm: '¿Salir del chat? Los mensajes locales de esta sala se eliminarán.', typeMessage: 'Escribe un mensaje', send: 'Enviar', attachImage: 'Adjuntar imagen', removeImage: 'Quitar imagen', imageUnsupported: 'Solo se admiten imágenes PNG, JPEG y WebP.', imageTooLarge: 'La imagen es demasiado grande tras la compresión.', imageProcessingFailed: 'No se pudo preparar la imagen.', liveLogs: 'Logs en directo', noLogs: 'Sin logs.', noMessages: 'Sin mensajes.', connectedUsers: 'Usuarios conectados', noConnectedUsers: 'No hay usuarios conectados', reply: 'Responder',
    statusDisconnected: 'desconectado', statusConnected: 'conectado', statusManualFailed: 'fallo manual', statusConnecting: 'conectando', statusOpen: 'abierto', statusClosed: 'cerrado',
    statusEnterNickname: 'Introduce un apodo antes de crear una invitación.', statusEnterChatName: 'Introduce un nombre de chat antes de crear una invitación.',
    logInviteNicknameRequired: 'Invite + offer bloqueado: apodo obligatorio.', logInviteChatNameRequired: 'Invite + offer bloqueado: nombre obligatorio.', logCreateNewChat: 'Creando chat y offer WebRTC para "{name}".',
    logCreateInviteExisting: 'Creando invitación para el chat "{name}".', logInviteCreated: 'Invite + offer creado. Envía este texto.', logInviteFailed: 'Error invite + offer: {error}',
    logPasteRequired: 'Señal manual fallida: pega invite+offer o answer.', logAnswerNeedsInvite: 'Esta answer no contiene invite.', logAnswerCreated: 'Answer creada. Envíala de vuelta.',
    logManualFailed: 'Señal manual fallida: {error}', logSendNeedsInvite: 'Envío fallido: crea o pega una invite.', logMessageSaved: 'Mensaje guardado localmente y se sincronizará al conectar.', logSendFailed: 'Envío fallido: {error}',
    logChatStopped: 'Chat detenido.', logLoaded: '{count} mensaje(s) cargado(s).', logPruned: '{count} mensaje(s) antiguo(s) eliminado(s); se conservan {limit}.', logRestored: 'Sala restaurada.', logSessionPrepared: 'Sesión WebRTC manual preparada.'
    , logHistoryCleared: '{count} mensaje(s) local(es) eliminado(s) de esta sala.', systemInvited: '{inviter} invitó a {invitee} al chat.'
  },
  'zh-CN': {
    subtitle: '多人 P2P 聊天，本地加密历史记录。', theme: '主题', light: '浅色', dark: '深色', language: '语言',
    nickname: '昵称 *', nicknamePlaceholder: '创建邀请前必填', chatName: '聊天名称 *', chatNamePlaceholder: '所有人可见的房间名称',
    newChatOffer: '新聊天 + Offer', inviteToCurrent: '邀请用户', connectionSetup: '连接设置', setupReadyToSend: '可发送', setupReadyToAccept: '可接受', setupIdle: '手动邀请交换',
    sendToUser: '1. 发送给其他用户', sendPlaceholder: '发送给其他用户的密钥',
    pasteReply: '2. 粘贴回复或邀请', pastePlaceholder: '在此粘贴其他用户的密钥',
    accept: '接受', chatFallback: '聊天', disconnect: '断开', disconnectConfirm: '要离开聊天吗？此房间的本地消息将被清除。', typeMessage: '输入消息', send: '发送', attachImage: '添加图片', removeImage: '移除图片', imageUnsupported: '仅支持 PNG、JPEG 和 WebP 图片。', imageTooLarge: '图片压缩后仍然过大。', imageProcessingFailed: '无法处理图片。', liveLogs: '实时日志', noLogs: '暂无日志。', noMessages: '暂无消息。', connectedUsers: '已连接用户', noConnectedUsers: '暂无已连接用户', reply: '回复',
    statusDisconnected: '已断开', statusConnected: '已连接', statusManualFailed: '手动失败', statusConnecting: '连接中', statusOpen: '已打开', statusClosed: '已关闭',
    statusEnterNickname: '创建邀请前请输入昵称。', statusEnterChatName: '创建邀请前请输入聊天名称。',
    logInviteNicknameRequired: 'Invite + offer 已阻止：需要昵称。', logInviteChatNameRequired: 'Invite + offer 已阻止：需要聊天名称。', logCreateNewChat: '正在为“{name}”创建聊天和 WebRTC offer。',
    logCreateInviteExisting: '正在为现有聊天“{name}”创建邀请。', logInviteCreated: 'Invite + offer 已创建。发送这段文本。', logInviteFailed: 'Invite + offer 失败：{error}',
    logPasteRequired: '手动信令失败：请先粘贴 invite+offer 或 answer。', logAnswerNeedsInvite: '此 answer 不包含 invite。', logAnswerCreated: 'Answer 已创建，请发回给第一个用户。',
    logManualFailed: '手动信令失败：{error}', logSendNeedsInvite: '发送失败：请先创建或粘贴 invite。', logMessageSaved: '消息已本地保存，将在 peer 连接后同步。', logSendFailed: '发送失败：{error}',
    logChatStopped: '聊天已停止。', logLoaded: '已加载 {count} 条保存消息。', logPruned: '已删除 {count} 条旧消息；保留最新 {limit} 条。', logRestored: '已恢复上次房间。', logSessionPrepared: '手动 WebRTC 信令会话已准备。'
    , logHistoryCleared: '已清除此房间的 {count} 条本地消息。', systemInvited: '{inviter} 邀请 {invitee} 加入聊天。'
  },
  ja: {
    subtitle: 'ローカル暗号化履歴付きのマルチユーザー P2P チャット。', theme: 'テーマ', light: 'ライト', dark: 'ダーク', language: '言語',
    nickname: 'ニックネーム *', nicknamePlaceholder: '招待作成前に必要です', chatName: 'チャット名 *', chatNamePlaceholder: '全員に表示されるルーム名',
    newChatOffer: '新規チャット + Offer', inviteToCurrent: 'ユーザーを招待', connectionSetup: '接続設定', setupReadyToSend: '送信準備完了', setupReadyToAccept: '受信準備完了', setupIdle: '手動招待交換',
    sendToUser: '1. 他のユーザーへ送信', sendPlaceholder: '他のユーザーに送信するキー',
    pasteReply: '2. 応答または招待を貼り付け', pastePlaceholder: '他のユーザーのキーをここに貼り付け',
    accept: '承認', chatFallback: 'チャット', disconnect: '切断', disconnectConfirm: 'チャットから退出しますか？このルームのローカルメッセージは削除されます。', typeMessage: 'メッセージを入力', send: '送信', attachImage: '画像を添付', removeImage: '画像を削除', imageUnsupported: 'PNG、JPEG、WebP 画像のみ対応しています。', imageTooLarge: '圧縮後の画像が大きすぎます。', imageProcessingFailed: '画像を準備できませんでした。', liveLogs: 'ライブログ', noLogs: 'ログはありません。', noMessages: 'メッセージはありません。', connectedUsers: '接続中のユーザー', noConnectedUsers: '接続中のユーザーはいません', reply: '返信',
    statusDisconnected: '切断済み', statusConnected: '接続済み', statusManualFailed: '手動失敗', statusConnecting: '接続中', statusOpen: 'オープン', statusClosed: 'クローズ',
    statusEnterNickname: '招待作成前にニックネームを入力してください。', statusEnterChatName: '招待作成前にチャット名を入力してください。',
    logInviteNicknameRequired: 'Invite + offer は停止されました: ニックネームが必要です。', logInviteChatNameRequired: 'Invite + offer は停止されました: チャット名が必要です。', logCreateNewChat: '「{name}」のチャットと WebRTC offer を作成中。',
    logCreateInviteExisting: '既存チャット「{name}」への招待を作成中。', logInviteCreated: 'Invite + offer を作成しました。このテキストを送信してください。', logInviteFailed: 'Invite + offer 失敗: {error}',
    logPasteRequired: '手動シグナル失敗: invite+offer または answer を貼り付けてください。', logAnswerNeedsInvite: 'この answer には invite がありません。', logAnswerCreated: 'Answer を作成しました。送り返してください。',
    logManualFailed: '手動シグナル失敗: {error}', logSendNeedsInvite: '送信失敗: 先に invite を作成または貼り付けてください。', logMessageSaved: 'メッセージをローカル保存しました。peer 接続時に同期します。', logSendFailed: '送信失敗: {error}',
    logChatStopped: 'チャットを停止しました。', logLoaded: '{count} 件の保存メッセージを読み込みました。', logPruned: '{count} 件の古いメッセージを削除し、最新 {limit} 件を保持します。', logRestored: '最後のルームを復元しました。', logSessionPrepared: '手動 WebRTC シグナリングセッションを準備しました。'
    , logHistoryCleared: 'このルームのローカルメッセージ {count} 件を削除しました。', systemInvited: '{inviter} が {invitee} をチャットに招待しました。'
  },
  ko: {
    subtitle: '로컬 암호화 기록을 가진 다중 사용자 P2P 채팅.', theme: '테마', light: '라이트', dark: '다크', language: '언어',
    nickname: '닉네임 *', nicknamePlaceholder: '초대 생성 전에 필요합니다', chatName: '채팅 이름 *', chatNamePlaceholder: '모두에게 보이는 방 이름',
    newChatOffer: '새 채팅 + Offer', inviteToCurrent: '사용자 초대', connectionSetup: '연결 설정', setupReadyToSend: '전송 준비됨', setupReadyToAccept: '수락 준비됨', setupIdle: '수동 초대 교환',
    sendToUser: '1. 다른 사용자에게 보내기', sendPlaceholder: '다른 사용자에게 보낼 키',
    pasteReply: '2. 응답 또는 초대 붙여넣기', pastePlaceholder: '다른 사용자의 키를 여기에 붙여넣으세요',
    accept: '수락', chatFallback: '채팅', disconnect: '연결 끊기', disconnectConfirm: '채팅에서 나가시겠습니까? 이 방의 로컬 메시지가 삭제됩니다.', typeMessage: '메시지 입력', send: '보내기', attachImage: '이미지 첨부', removeImage: '이미지 제거', imageUnsupported: 'PNG, JPEG, WebP 이미지만 지원됩니다.', imageTooLarge: '압축 후에도 이미지가 너무 큽니다.', imageProcessingFailed: '이미지를 준비하지 못했습니다.', liveLogs: '실시간 로그', noLogs: '로그가 없습니다.', noMessages: '메시지가 없습니다.', connectedUsers: '연결된 사용자', noConnectedUsers: '연결된 사용자가 없습니다', reply: '답장',
    statusDisconnected: '연결 끊김', statusConnected: '연결됨', statusManualFailed: '수동 실패', statusConnecting: '연결 중', statusOpen: '열림', statusClosed: '닫힘',
    statusEnterNickname: '초대 생성 전에 닉네임을 입력하세요.', statusEnterChatName: '초대 생성 전에 채팅 이름을 입력하세요.',
    logInviteNicknameRequired: 'Invite + offer 차단됨: 닉네임 필요.', logInviteChatNameRequired: 'Invite + offer 차단됨: 채팅 이름 필요.', logCreateNewChat: '"{name}" 채팅과 WebRTC offer 생성 중.',
    logCreateInviteExisting: '기존 채팅 "{name}" 초대 생성 중.', logInviteCreated: 'Invite + offer 생성됨. 이 텍스트를 보내세요.', logInviteFailed: 'Invite + offer 실패: {error}',
    logPasteRequired: '수동 신호 실패: invite+offer 또는 answer를 붙여넣으세요.', logAnswerNeedsInvite: '이 answer에는 invite가 없습니다.', logAnswerCreated: 'Answer 생성됨. 다시 보내세요.',
    logManualFailed: '수동 신호 실패: {error}', logSendNeedsInvite: '전송 실패: 먼저 invite를 만들거나 붙여넣으세요.', logMessageSaved: '메시지가 로컬에 저장되었고 peer 연결 시 동기화됩니다.', logSendFailed: '전송 실패: {error}',
    logChatStopped: '채팅 중지됨.', logLoaded: '저장된 메시지 {count}개 로드됨.', logPruned: '이전 메시지 {count}개 삭제; 최신 {limit}개 유지.', logRestored: '마지막 방 복원됨.', logSessionPrepared: '수동 WebRTC signaling 세션 준비됨.'
    , logHistoryCleared: '이 방의 로컬 메시지 {count}개를 삭제했습니다.', systemInvited: '{inviter}님이 {invitee}님을 채팅에 초대했습니다.'
  },
  'pt-BR': {
    subtitle: 'Chat P2P multiusuário com histórico local criptografado.', theme: 'Tema', light: 'Claro', dark: 'Escuro', language: 'Idioma',
    nickname: 'Apelido *', nicknamePlaceholder: 'Obrigatório antes de criar convite', chatName: 'Nome do chat *', chatNamePlaceholder: 'Nome visível para todos',
    newChatOffer: 'Novo chat + Offer', inviteToCurrent: 'Convidar usuário', connectionSetup: 'Conexão', setupReadyToSend: 'pronto para enviar', setupReadyToAccept: 'pronto para aceitar', setupIdle: 'troca manual de convite',
    sendToUser: '1. Enviar para outro usuário', sendPlaceholder: 'Chave para enviar a outro usuário',
    pasteReply: '2. Colar resposta ou convite', pastePlaceholder: 'Cole aqui a chave de outro usuário',
    accept: 'Aceitar', chatFallback: 'Chat', disconnect: 'Desconectar', disconnectConfirm: 'Sair do chat? As mensagens locais desta sala serão apagadas.', typeMessage: 'Digite uma mensagem', send: 'Enviar', attachImage: 'Anexar imagem', removeImage: 'Remover imagem', imageUnsupported: 'Somente imagens PNG, JPEG e WebP são suportadas.', imageTooLarge: 'A imagem ficou grande demais após a compressão.', imageProcessingFailed: 'Não foi possível preparar a imagem.', liveLogs: 'Logs ao vivo', noLogs: 'Sem logs.', noMessages: 'Sem mensagens.', connectedUsers: 'Usuários conectados', noConnectedUsers: 'Nenhum usuário conectado', reply: 'Responder',
    statusDisconnected: 'desconectado', statusConnected: 'conectado', statusManualFailed: 'falha manual', statusConnecting: 'conectando', statusOpen: 'aberto', statusClosed: 'fechado',
    statusEnterNickname: 'Digite um apelido antes de criar convite.', statusEnterChatName: 'Digite um nome de chat antes de criar convite.',
    logInviteNicknameRequired: 'Invite + offer bloqueado: apelido obrigatório.', logInviteChatNameRequired: 'Invite + offer bloqueado: nome obrigatório.', logCreateNewChat: 'Criando chat e WebRTC offer para "{name}".',
    logCreateInviteExisting: 'Criando convite para o chat "{name}".', logInviteCreated: 'Invite + offer criado. Envie este texto.', logInviteFailed: 'Falha invite + offer: {error}',
    logPasteRequired: 'Sinal manual falhou: cole invite+offer ou answer.', logAnswerNeedsInvite: 'Este answer não contém invite.', logAnswerCreated: 'Answer criado. Envie de volta.',
    logManualFailed: 'Sinal manual falhou: {error}', logSendNeedsInvite: 'Falha ao enviar: crie ou cole um invite.', logMessageSaved: 'Mensagem salva localmente e sincronizará quando um peer conectar.', logSendFailed: 'Falha ao enviar: {error}',
    logChatStopped: 'Chat parado.', logLoaded: '{count} mensagem(ns) carregada(s).', logPruned: '{count} mensagem(ns) antiga(s) removida(s); mantendo {limit}.', logRestored: 'Sala restaurada.', logSessionPrepared: 'Sessão WebRTC manual pronta.'
    , logHistoryCleared: '{count} mensagem(ns) local(is) removida(s) desta sala.', systemInvited: '{inviter} convidou {invitee} para o chat.'
  },
  'zh-TW': {
    subtitle: '多人 P2P 聊天，本機加密歷史記錄。', theme: '主題', light: '淺色', dark: '深色', language: '語言',
    nickname: '暱稱 *', nicknamePlaceholder: '建立邀請前必填', chatName: '聊天名稱 *', chatNamePlaceholder: '所有人可見的房間名稱',
    newChatOffer: '新聊天 + Offer', inviteToCurrent: '邀請使用者', connectionSetup: '連線設定', setupReadyToSend: '可傳送', setupReadyToAccept: '可接受', setupIdle: '手動邀請交換',
    sendToUser: '1. 傳送給其他使用者', sendPlaceholder: '傳送給其他使用者的金鑰',
    pasteReply: '2. 貼上回覆或邀請', pastePlaceholder: '在此貼上其他使用者的金鑰',
    accept: '接受', chatFallback: '聊天', disconnect: '中斷', disconnectConfirm: '要離開聊天嗎？此房間的本機訊息將被清除。', typeMessage: '輸入訊息', send: '傳送', attachImage: '附加圖片', removeImage: '移除圖片', imageUnsupported: '僅支援 PNG、JPEG 和 WebP 圖片。', imageTooLarge: '圖片壓縮後仍然過大。', imageProcessingFailed: '無法準備圖片。', liveLogs: '即時日誌', noLogs: '尚無日誌。', noMessages: '尚無訊息。', connectedUsers: '已連線使用者', noConnectedUsers: '尚無已連線使用者', reply: '回覆',
    statusDisconnected: '已中斷', statusConnected: '已連線', statusManualFailed: '手動失敗', statusConnecting: '連線中', statusOpen: '已開啟', statusClosed: '已關閉',
    statusEnterNickname: '建立邀請前請輸入暱稱。', statusEnterChatName: '建立邀請前請輸入聊天名稱。',
    logInviteNicknameRequired: 'Invite + offer 已阻止：需要暱稱。', logInviteChatNameRequired: 'Invite + offer 已阻止：需要聊天名稱。', logCreateNewChat: '正在為「{name}」建立聊天和 WebRTC offer。',
    logCreateInviteExisting: '正在為現有聊天「{name}」建立邀請。', logInviteCreated: 'Invite + offer 已建立。請傳送此文字。', logInviteFailed: 'Invite + offer 失敗：{error}',
    logPasteRequired: '手動信令失敗：請先貼上 invite+offer 或 answer。', logAnswerNeedsInvite: '此 answer 不包含 invite。', logAnswerCreated: 'Answer 已建立，請傳回給第一位使用者。',
    logManualFailed: '手動信令失敗：{error}', logSendNeedsInvite: '傳送失敗：請先建立或貼上 invite。', logMessageSaved: '訊息已本機儲存，peer 連線後會同步。', logSendFailed: '傳送失敗：{error}',
    logChatStopped: '聊天已停止。', logLoaded: '已載入 {count} 則保存訊息。', logPruned: '已刪除 {count} 則舊訊息；保留最新 {limit} 則。', logRestored: '已還原上次房間。', logSessionPrepared: '手動 WebRTC 信令工作階段已準備。'
    , logHistoryCleared: '已清除此房間的 {count} 則本機訊息。', systemInvited: '{inviter} 邀請 {invitee} 加入聊天。'
  },
  pl: {
    subtitle: 'Wieloosobowy czat P2P z lokalnie szyfrowaną historią.', theme: 'Motyw', light: 'Jasny', dark: 'Ciemny', language: 'Język',
    nickname: 'Nick *', nicknamePlaceholder: 'Wymagany przed utworzeniem zaproszenia', chatName: 'Nazwa czatu *', chatNamePlaceholder: 'Nazwa widoczna dla wszystkich',
    newChatOffer: 'Nowy czat + Offer', inviteToCurrent: 'Zaproś użytkownika', connectionSetup: 'Połączenie', setupReadyToSend: 'gotowe do wysłania', setupReadyToAccept: 'gotowe do przyjęcia', setupIdle: 'ręczna wymiana zaproszenia',
    sendToUser: '1. Wyślij do innego użytkownika', sendPlaceholder: 'Klucz do wysłania innemu użytkownikowi',
    pasteReply: '2. Wklej odpowiedź lub zaproszenie', pastePlaceholder: 'Wklej tutaj klucz innego użytkownika',
    accept: 'Akceptuj', chatFallback: 'Czat', disconnect: 'Rozłącz', disconnectConfirm: 'Opuścić czat? Lokalne wiadomości tego pokoju zostaną usunięte.', typeMessage: 'Wpisz wiadomość', send: 'Wyślij', attachImage: 'Dołącz obraz', removeImage: 'Usuń obraz', imageUnsupported: 'Obsługiwane są tylko obrazy PNG, JPEG i WebP.', imageTooLarge: 'Obraz jest zbyt duży po kompresji.', imageProcessingFailed: 'Nie udało się przygotować obrazu.', liveLogs: 'Logi na żywo', noLogs: 'Brak logów.', noMessages: 'Brak wiadomości.', connectedUsers: 'Połączeni użytkownicy', noConnectedUsers: 'Brak połączonych użytkowników', reply: 'Odpowiedz',
    statusDisconnected: 'rozłączono', statusConnected: 'połączono', statusManualFailed: 'błąd ręczny', statusConnecting: 'łączenie', statusOpen: 'otwarte', statusClosed: 'zamknięte',
    statusEnterNickname: 'Wpisz nick przed utworzeniem zaproszenia.', statusEnterChatName: 'Wpisz nazwę czatu przed utworzeniem zaproszenia.',
    logInviteNicknameRequired: 'Invite + offer zablokowane: wymagany nick.', logInviteChatNameRequired: 'Invite + offer zablokowane: wymagana nazwa czatu.', logCreateNewChat: 'Tworzenie czatu i WebRTC offer dla „{name}”.',
    logCreateInviteExisting: 'Tworzenie zaproszenia do czatu „{name}”.', logInviteCreated: 'Invite + offer utworzone. Wyślij ten tekst.', logInviteFailed: 'Invite + offer nieudane: {error}',
    logPasteRequired: 'Sygnał ręczny nieudany: wklej invite+offer albo answer.', logAnswerNeedsInvite: 'Ten answer nie zawiera invite.', logAnswerCreated: 'Answer utworzony. Odeślij go.',
    logManualFailed: 'Sygnał ręczny nieudany: {error}', logSendNeedsInvite: 'Wysyłanie nieudane: utwórz lub wklej invite.', logMessageSaved: 'Wiadomość zapisana lokalnie i zsynchronizuje się po połączeniu peer.', logSendFailed: 'Wysyłanie nieudane: {error}',
    logChatStopped: 'Czat zatrzymany.', logLoaded: 'Wczytano {count} zapisanych wiadomości.', logPruned: 'Usunięto {count} starych wiadomości; zachowano {limit}.', logRestored: 'Przywrócono ostatni pokój.', logSessionPrepared: 'Ręczna sesja WebRTC signaling gotowa.'
    , logHistoryCleared: 'Usunięto {count} lokalnych wiadomości z tego pokoju.', systemInvited: '{inviter} zaprosił(a) {invitee} do czatu.'
  }
}

function format(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''))
}

function detectLocale(): Locale {
  const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
  if (isLocale(saved)) return saved
  const normalized = navigator.language
  const exact = localeOptions.find((option) => option.value.toLowerCase() === normalized.toLowerCase())
  if (exact) return exact.value
  const prefix = normalized.split('-')[0]
  const prefixed = localeOptions.find((option) => option.value.split('-')[0] === prefix)
  return prefixed?.value ?? 'en'
}

function isLocale(value: string | null): value is Locale {
  return localeOptions.some((option) => option.value === value)
}

function detectTheme(): Theme {
  const saved = localStorage.getItem(THEME_STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getLocalPeerId() {
  const saved = localStorage.getItem(PEER_ID_STORAGE_KEY)
  if (saved) return saved
  const next = crypto.randomUUID()
  localStorage.setItem(PEER_ID_STORAGE_KEY, next)
  return next
}

function LogView({ logs, emptyText }: { logs: LogLine[]; emptyText: string }) {
  if (logs.length === 0) return <p className="muted">{emptyText}</p>
  return (
    <ol className="log-list">
      {logs.map((line) => (
        <li key={line.id}>
          <time>{new Date(line.timestamp).toLocaleTimeString()}</time>
          <span>{line.message}</span>
        </li>
      ))}
    </ol>
  )
}

function ChatView({
  messages,
  emptyText,
  localPeerId,
  jumpToMessageId,
  jumpRequest,
  unreadMentionIds,
  replyLabel,
  onReply
}: {
  messages: ChatMessage[]
  emptyText: string
  localPeerId: string
  jumpToMessageId: string
  jumpRequest: number
  unreadMentionIds: string[]
  replyLabel: string
  onReply(message: ChatMessage): void
}) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const messageRefs = useRef(new Map<string, HTMLElement>())
  const lastMessageId = messages.at(-1)?.id ?? ''
  const previousLastMessageId = useRef(lastMessageId)

  useEffect(() => {
    if (!lastMessageId || previousLastMessageId.current === lastMessageId || jumpToMessageId) return
    previousLastMessageId.current = lastMessageId
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [lastMessageId, jumpToMessageId])

  useEffect(() => {
    if (!jumpToMessageId) return
    const scrollToTarget = () => {
      const list = listRef.current
      const message = messageRefs.current.get(jumpToMessageId)
      if (list == null || message == null) return
      const listRect = list.getBoundingClientRect()
      const messageRect = message.getBoundingClientRect()
      const messageTopInList = list.scrollTop + messageRect.top - listRect.top
      const targetTop = messageTopInList - (list.clientHeight - messageRect.height) / 2
      const maxTop = list.scrollHeight - list.clientHeight
      const top = Math.min(Math.max(0, targetTop), Math.max(0, maxTop))
      list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    }
    requestAnimationFrame(() => {
      scrollToTarget()
      requestAnimationFrame(scrollToTarget)
    })
  }, [jumpToMessageId, jumpRequest])

  if (messages.length === 0) return <p className="muted">{emptyText}</p>
  return (
    <div className="chat-list" ref={listRef}>
      {messages.map((message) => {
        const mentionedMe = message.direction === 'in' && (message.mentionPeerIds ?? []).includes(localPeerId) && unreadMentionIds.includes(message.id)
        return (
          <article
            className={`chat-message ${message.direction}${mentionedMe ? ' mentioned-me' : ''}${jumpToMessageId === message.id ? ' jump-target' : ''}`}
            key={message.id}
            ref={(element) => {
              if (element == null) messageRefs.current.delete(message.id)
              else messageRefs.current.set(message.id, element)
            }}
          >
            <div>
              <strong>{message.author}</strong>
              <time>{new Date(message.timestamp).toLocaleTimeString()}</time>
              {message.direction === 'in' ? (
                <button type="button" className="reply-message" onClick={() => onReply(message)}>{replyLabel}</button>
              ) : null}
            </div>
            {message.image ? (
              <img
                className="chat-image"
                src={message.image.dataUrl}
                alt={message.image.name || 'Attached image'}
                loading="lazy"
              />
            ) : null}
            {message.text ? <p>{renderMessageText(message.text)}</p> : null}
          </article>
        )
      })}
    </div>
  )
}

function renderMessageText(text: string) {
  const parts: React.ReactNode[] = []
  const linkPattern = /\b(?:https?:\/\/|www\.)[^\s<]+/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = linkPattern.exec(text)) != null) {
    const rawMatch = match[0]
    const start = match.index
    const { linkText, trailingText } = splitTrailingLinkPunctuation(rawMatch)
    const end = start + linkText.length

    if (start > lastIndex) parts.push(text.slice(lastIndex, start))
    parts.push(
      <a
        href={linkText.startsWith('www.') ? `https://${linkText}` : linkText}
        target="_blank"
        rel="noreferrer noopener"
        key={`${start}-${linkText}`}
      >
        {linkText}
      </a>
    )
    if (trailingText) parts.push(trailingText)
    lastIndex = end + trailingText.length
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function splitTrailingLinkPunctuation(value: string) {
  const match = value.match(/^(.*?)([.,!?)]+)?$/)
  return {
    linkText: match?.[1] || value,
    trailingText: match?.[2] || ''
  }
}

function ConnectedUsers({
  peers,
  emptyText,
  localPeerId,
  onMention
}: {
  peers: ChatPeer[]
  emptyText: string
  localPeerId: string
  onMention(peer: ChatPeer): void
}) {
  const mentionablePeers = peers.filter((peer) => peer.id !== localPeerId)
  return (
    <div className="connected-users">
      <select
        value=""
        onChange={(event) => {
          const peer = mentionablePeers.find((item) => item.id === event.target.value)
          if (peer != null) onMention(peer)
        }}
        disabled={mentionablePeers.length === 0}
      >
        <option value="">{mentionablePeers.length === 0 ? emptyText : 'Select user'}</option>
        {mentionablePeers.map((peer) => (
          <option value={peer.id} key={peer.id}>{peer.name}</option>
        ))}
      </select>
    </div>
  )
}

function LoadingLabel({ label }: { label: string }) {
  return (
    <span className="loading-label">
      <span className="button-spinner" aria-hidden="true" />
      {label}
    </span>
  )
}

function App() {
  const [locale, setLocale] = useState<Locale>(() => detectLocale())
  const [theme, setTheme] = useState<Theme>(() => detectTheme())
  const [invite, setInvite] = useState('')
  const [joinInvite, setJoinInvite] = useState('')
  const [nickname, setNickname] = useState(() => localStorage.getItem('p2p-chat:nickname') ?? '')
  const [mailboxKey, setMailboxKey] = useState('')
  const [status, setStatus] = useState('')
  const [logs, setLogs] = useState<LogLine[]>([])
  const [chatStatus, setChatStatus] = useState('disconnected')
  const [chatText, setChatText] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [connectedPeers, setConnectedPeers] = useState<ChatPeer[]>([])
  const [manualSignalOut, setManualSignalOut] = useState('')
  const [manualSignalIn, setManualSignalIn] = useState('')
  const [connectionSetupOpen, setConnectionSetupOpen] = useState(false)
  const [chatInviteSetupOpen, setChatInviteSetupOpen] = useState(false)
  const [creatingMode, setCreatingMode] = useState<'new' | 'current' | ''>('')
  const [acceptingSignal, setAcceptingSignal] = useState(false)
  const [pendingMentionPeerIds, setPendingMentionPeerIds] = useState<string[]>([])
  const [pendingMentionPeers, setPendingMentionPeers] = useState<ChatPeer[]>([])
  const [unreadMentionIds, setUnreadMentionIds] = useState<string[]>([])
  const [jumpToMessageId, setJumpToMessageId] = useState('')
  const [jumpRequest, setJumpRequest] = useState(0)
  const [selectedImage, setSelectedImage] = useState<ChatImageAttachment | undefined>()
  const [imageBusy, setImageBusy] = useState(false)
  const [localPeerId] = useState(() => getLocalPeerId())
  const chatSession = useRef<TrackerChatSession | null>(null)
  const chatMessagesRef = useRef<ChatMessage[]>([])
  const chatTextRef = useRef<HTMLTextAreaElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const t = translations[locale]

  useEffect(() => {
    const initialProfile = {
      nickname,
      chatName: '',
      localPeerId,
      locale
    }
    void sendRuntimeCommand({ type: 'snapshot', profile: initialProfile }).then(applyRuntimeSnapshot)
  }, [])

  useEffect(() => {
    const listener = (message: unknown) => {
      const event = message as { channel?: string; snapshot?: RuntimeSnapshot }
      if (event.channel === 'offscreen-event' && event.snapshot != null) applyRuntimeSnapshot(event.snapshot)
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  useEffect(() => {
    localStorage.setItem('p2p-chat:nickname', nickname)
    void sendRuntimeCommand({ type: 'profile', profile: runtimeProfile(nickname) }).then(applyRuntimeSnapshot)
  }, [nickname])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    if (!chatStatus.toLowerCase().includes('disconnected') || !mailboxKey) return
    setConnectedPeers([])
  }, [chatStatus, mailboxKey])

  useEffect(() => {
    if (chatTextRef.current == null) return
    chatTextRef.current.style.height = 'auto'
    chatTextRef.current.style.height = `${chatTextRef.current.scrollHeight}px`
  }, [chatText])

  function appendLog(message: string) {
    setLogs((current) => [
      { id: crypto.randomUUID(), timestamp: Date.now(), message },
      ...current
    ].slice(0, 80))
  }

  function runtimeProfile(nextNickname = nickname): RuntimeProfile {
    return {
      nickname: nextNickname,
      chatName: '',
      localPeerId,
      locale
    }
  }

  async function sendRuntimeCommand(command: RuntimeCommand): Promise<RuntimeSnapshot | undefined> {
    const response = await chrome.runtime.sendMessage({ channel: 'ui-command', command }) as { ok?: boolean; error?: string; snapshot?: RuntimeSnapshot }
    if (!response?.ok) {
      if (response?.error) appendLog(response.error)
      return response?.snapshot
    }
    return response.snapshot
  }

  function applyRuntimeSnapshot(snapshot?: RuntimeSnapshot) {
    if (snapshot == null) return
    setInvite(snapshot.invite)
    setJoinInvite(snapshot.joinInvite)
    setMailboxKey(snapshot.mailboxKey)
    setLogs(snapshot.logs)
    setChatStatus(snapshot.chatStatus)
    setChatMessages(snapshot.chatMessages)
    chatMessagesRef.current = snapshot.chatMessages
    setConnectedPeers(snapshot.connectedPeers)
    setManualSignalOut(snapshot.manualSignalOut)
    setUnreadMentionIds(snapshot.unreadMentionIds ?? [])
  }

  async function loadChatHistory(nextMailboxKey: string) {
    const stored = await db.chatMessages.where('mailboxKey').equals(nextMailboxKey).sortBy('timestamp')
    const messages = stored
      .slice(-CHAT_MESSAGE_LIMIT)
      .map(({ id, author, authorPeerId, text, image, timestamp, direction, mentionPeerIds }) => ({ id, author, authorPeerId, text, image, timestamp, direction, mentionPeerIds }))
    chatMessagesRef.current = messages
    setChatMessages(messages)
    if (stored.length > CHAT_MESSAGE_LIMIT) void pruneChatHistory(nextMailboxKey)
    appendLog(format(t.logLoaded, { count: messages.length }))
  }

  async function pruneChatHistory(nextMailboxKey: string) {
    const stored = await db.chatMessages.where('mailboxKey').equals(nextMailboxKey).sortBy('timestamp')
    const excess = stored.slice(0, Math.max(0, stored.length - CHAT_MESSAGE_LIMIT))
    if (excess.length === 0) return
    await db.chatMessages.bulkDelete(excess.map((message) => message.id))
    appendLog(format(t.logPruned, { count: excess.length, limit: CHAT_MESSAGE_LIMIT }))
  }

  async function clearLocalChatHistory(nextMailboxKey: string) {
    const visibleCount = chatMessagesRef.current.length
    const deletedCount = await db.chatMessages.where('mailboxKey').equals(nextMailboxKey).delete()
    chatMessagesRef.current = []
    setChatMessages([])
    setChatText('')
    if (deletedCount > 0 || visibleCount > 0) appendLog(format(t.logHistoryCleared, { count: deletedCount }))
  }

  async function restoreLastRoom() {
    const savedMailboxKey = localStorage.getItem('p2p-chat:lastMailboxKey')
    const savedInvite = localStorage.getItem('p2p-chat:lastInvite')
    const latestInvite = savedMailboxKey
      ? await db.invites.where('mailboxKey').equals(savedMailboxKey).last()
      : await db.invites.orderBy('createdAt').last()
    const nextInvite = savedInvite || latestInvite?.invite
    const nextMailboxKey = latestInvite?.mailboxKey ?? (nextInvite ? await mailboxKeyFromInvite(nextInvite) : savedMailboxKey)
    if (!nextMailboxKey) return

    if (nextInvite) {
      setInvite(nextInvite)
      setJoinInvite(nextInvite)
      localStorage.setItem('p2p-chat:lastInvite', nextInvite)
    }
    setMailboxKey(nextMailboxKey)
    localStorage.setItem('p2p-chat:lastMailboxKey', nextMailboxKey)
    await loadChatHistory(nextMailboxKey)
    appendLog(t.logRestored)
  }

  function rememberActiveRoom(nextInvite: string, nextMailboxKey: string) {
    localStorage.setItem('p2p-chat:lastInvite', nextInvite)
    localStorage.setItem('p2p-chat:lastMailboxKey', nextMailboxKey)
  }

  async function rememberChatMessage(message: ChatMessage, nextMailboxKey = mailboxKey) {
    if (!nextMailboxKey) return
    const normalized: StoredChatMessage = {
      id: message.id,
      mailboxKey: nextMailboxKey,
      author: message.author,
      authorPeerId: message.authorPeerId,
      text: message.text,
      image: message.image,
      timestamp: message.timestamp,
      direction: message.direction,
      mentionPeerIds: message.mentionPeerIds
    }
    await db.chatMessages.put(normalized)
  }

  function mergeChatMessages(messages: ChatMessage[], nextMailboxKey = mailboxKey) {
    setChatMessages((current) => {
      const seen = new Set(current.map((message) => message.id))
      const merged = [...current]
      let changed = false
      for (const message of messages) {
        if (seen.has(message.id)) continue
        seen.add(message.id)
        merged.push(message)
        changed = true
        void rememberChatMessage(message, nextMailboxKey)
      }
      merged.sort((a, b) => a.timestamp - b.timestamp)
      const capped = merged.slice(-CHAT_MESSAGE_LIMIT)
      chatMessagesRef.current = capped
      if (changed) void pruneChatHistory(nextMailboxKey)
      return capped
    })
  }

  function rememberPeer(peer: ChatPeer) {
    if (peer.id === localPeerId) return
    setConnectedPeers((current) => {
      const withoutPeer = current.filter((item) => item.id !== peer.id)
      return [...withoutPeer, peer].sort((a, b) => a.name.localeCompare(b.name))
    })
  }

  function forgetPeer(peerId: string) {
    setConnectedPeers((current) => current.filter((peer) => peer.id !== peerId))
  }

  async function attachImageFile(file: File) {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      setStatus(t.imageUnsupported)
      appendLog(t.imageUnsupported)
      return
    }
    setImageBusy(true)
    try {
      const image = await prepareImageAttachment(file)
      setSelectedImage(image)
      setStatus('')
    } catch (error) {
      const message = error instanceof ImageTooLargeError ? t.imageTooLarge : t.imageProcessingFailed
      setStatus(message)
      appendLog(`${message}${error instanceof Error ? ` ${error.message}` : ''}`)
    } finally {
      setImageBusy(false)
      if (imageInputRef.current != null) imageInputRef.current.value = ''
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageFile = [...event.clipboardData.files].find((file) => file.type.startsWith('image/'))
    if (imageFile == null) return
    event.preventDefault()
    void attachImageFile(imageFile)
  }

  function handleImageInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file == null) return
    void attachImageFile(file)
  }

  function localPeer(): ChatPeer {
    return { id: localPeerId, name: nickname.trim() }
  }

  function addSystemInviteMessage(inviteeName: string, nextMailboxKey = mailboxKey) {
    const inviterName = nickname.trim()
    if (!inviterName) return
    const systemMessage: ChatMessage = {
      id: crypto.randomUUID(),
      author: 'system',
      text: format(t.systemInvited, { inviter: inviterName, invitee: inviteeName }),
      timestamp: Date.now(),
      direction: 'system'
    }
    mergeChatMessages([systemMessage], nextMailboxKey)
    void chatSession.current?.sendExisting(systemMessage).catch((error) => appendLog(format(t.logSendFailed, { error: error instanceof Error ? error.message : String(error) })))
  }

  async function ensureManualSession(chatInvite: string, nextMailboxKey: string) {
    if (chatSession.current != null) return chatSession.current
    await loadChatHistory(nextMailboxKey)
    const session = new TrackerChatSession({
      onLog: appendLog,
      onMessage: (message) => mergeChatMessages([message], nextMailboxKey),
      onHistory: (messages) => mergeChatMessages(messages, nextMailboxKey),
      onPeer: rememberPeer,
      onPeerLeft: forgetPeer,
      getHistory: () => chatMessagesRef.current,
      getLocalPeer: localPeer,
      getKnownPeers: () => connectedPeers,
      onStatus: setChatStatus
    })
    chatSession.current = session
    appendLog(t.logSessionPrepared)
    parseInvite(chatInvite)
    return session
  }

  async function createInviteOfferBundle(mode: 'new' | 'current') {
    if (creatingMode || acceptingSignal) return
    if (!nickname.trim()) {
      setStatus(t.statusEnterNickname)
      appendLog(t.logInviteNicknameRequired)
      return
    }
    setCreatingMode(mode)
    try {
      applyRuntimeSnapshot(await sendRuntimeCommand({ type: 'createInviteOffer', mode, profile: runtimeProfile() }))
      setConnectionSetupOpen(true)
      if (mode === 'current') setChatInviteSetupOpen(true)
    } catch (error) {
      appendLog(format(t.logInviteFailed, { error: error instanceof Error ? error.message : String(error) }))
      setChatStatus('manual failed')
    } finally {
      setCreatingMode('')
    }
  }

  async function acceptManualSignal() {
    if (creatingMode || acceptingSignal) return
    if (!nickname.trim()) {
      setStatus(t.statusEnterNickname)
      appendLog(t.logInviteNicknameRequired)
      return
    }
    if (!manualSignalIn.trim()) {
      appendLog(t.logPasteRequired)
      return
    }
    setAcceptingSignal(true)
    try {
      applyRuntimeSnapshot(await sendRuntimeCommand({ type: 'acceptSignal', signal: manualSignalIn, profile: runtimeProfile() }))
      setConnectionSetupOpen(true)
      if (chatStatus === 'connected') setChatInviteSetupOpen(true)
      setManualSignalIn('')
    } catch (error) {
      appendLog(format(t.logManualFailed, { error: error instanceof Error ? error.message : String(error) }))
      setChatStatus('manual failed')
    } finally {
      setAcceptingSignal(false)
    }
  }

  function mentionPeer(peer: ChatPeer) {
    const mentionText = `@${peer.name} `
    setPendingMentionPeerIds((current) => current.includes(peer.id) ? current : [...current, peer.id])
    setPendingMentionPeers((current) => current.some((item) => item.id === peer.id) ? current : [...current, peer])
    setChatText((current) => {
      const withoutExisting = current.startsWith(mentionText) ? current.slice(mentionText.length) : current
      return `${mentionText}${withoutExisting}`
    })
    requestAnimationFrame(() => {
      chatTextRef.current?.focus()
      chatTextRef.current?.setSelectionRange(mentionText.length, mentionText.length)
    })
  }

  function replyToMessage(message: ChatMessage) {
    const fallbackPeer = connectedPeers.find((peer) => peer.name === message.author)
    const replyPeer = message.authorPeerId
      ? { id: message.authorPeerId, name: message.author }
      : fallbackPeer
    if (replyPeer == null || replyPeer.id === localPeerId) return
    mentionPeer(replyPeer)
  }

  async function openNextMention() {
    const messageId = unreadMentionIds.find((id) => chatMessages.some((message) => message.id === id))
    if (messageId == null) return
    setJumpToMessageId(messageId)
    setJumpRequest((current) => current + 1)
    window.setTimeout(() => setJumpToMessageId((current) => current === messageId ? '' : current), 900)
    applyRuntimeSnapshot(await sendRuntimeCommand({ type: 'markMentionRead', messageId }))
  }

  async function sendChatMessage() {
    const text = chatText.trim()
    const image = selectedImage
    if (!text && image == null) return
    if (!nickname.trim()) {
      setStatus(t.statusEnterNickname)
      appendLog(t.logInviteNicknameRequired)
      return
    }
    try {
      setChatText('')
      setSelectedImage(undefined)
      const mentionPeerIds = pendingMentionPeerIds.filter((peerId) => {
        const peer = pendingMentionPeers.find((item) => item.id === peerId) ?? connectedPeers.find((item) => item.id === peerId)
        return peer != null && text.includes(`@${peer.name}`)
      })
      setPendingMentionPeerIds([])
      setPendingMentionPeers([])
      applyRuntimeSnapshot(await sendRuntimeCommand({ type: 'sendMessage', text, image, mentionPeerIds, profile: runtimeProfile() }))
    } catch (error) {
      setSelectedImage(image)
      appendLog(format(t.logSendFailed, { error: error instanceof Error ? error.message : String(error) }))
    }
  }

  async function stopChat() {
    if (!window.confirm(t.disconnectConfirm)) return
    applyRuntimeSnapshot(await sendRuntimeCommand({ type: 'disconnect' }))
    setConnectionSetupOpen(true)
    setChatInviteSetupOpen(false)
  }

  const setupStatus = manualSignalIn.trim()
    ? t.setupReadyToAccept
    : manualSignalOut.trim()
      ? t.setupReadyToSend
      : t.setupIdle
  const visiblePeers = chatStatus === 'connected' ? [localPeer(), ...connectedPeers] : []
  const isSignalBusy = creatingMode !== '' || acceptingSignal
  const hasNickname = nickname.trim().length > 0
  const isChatConnected = chatStatus === 'connected'
  const showConnectionView = !isChatConnected

  return (
    <main className="app-shell">
      <header className="topbar">
        <img src="/assets/icon-128.png" alt="" />
        <div>
          <h1>Group HandLink Chat</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="toolbar">
          <label aria-label={t.theme}>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
              aria-label={t.theme}
              title={theme === 'light' ? t.light : t.dark}
            >
              {theme === 'light' ? <SunIcon /> : <MoonIcon />}
            </button>
          </label>
          <label aria-label={t.language}>
            <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label={t.language}>
              {localeOptions.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {showConnectionView ? (
        <>
          <section className="panel controls">
            <label>
              <span>{t.nickname}</span>
              <input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder={t.nicknamePlaceholder} required />
            </label>
            <button type="button" onClick={() => void createInviteOfferBundle('new')} disabled={!hasNickname || isSignalBusy}>
              {creatingMode === 'new' ? <LoadingLabel label={t.newChatOffer} /> : t.newChatOffer}
            </button>
            <button type="button" className="secondary" onClick={() => void createInviteOfferBundle('current')} disabled={!hasNickname || !(invite || joinInvite) || isSignalBusy}>
              {creatingMode === 'current' ? <LoadingLabel label={t.inviteToCurrent} /> : t.inviteToCurrent}
            </button>
          </section>
          {status ? <p className="status-line">{status}</p> : null}

          <details className="panel advanced connection-setup" open={connectionSetupOpen} onToggle={(event) => setConnectionSetupOpen(event.currentTarget.open)}>
            <summary>
              <span>{t.connectionSetup}</span>
              <small>{setupStatus}</small>
            </summary>
            <section className="advanced-section setup-grid">
              <label>
                <span>{t.sendToUser}</span>
                <textarea value={manualSignalOut} readOnly placeholder={t.sendPlaceholder} />
              </label>
              <label>
                <span>{t.pasteReply}</span>
                <textarea value={manualSignalIn} onChange={(event) => {
                  setManualSignalIn(event.target.value)
                  if (event.target.value.trim()) setConnectionSetupOpen(true)
                }} placeholder={t.pastePlaceholder} />
                <button type="button" onClick={() => void acceptManualSignal()} disabled={!hasNickname || !manualSignalIn.trim() || isSignalBusy}>
                  {acceptingSignal ? <LoadingLabel label={t.accept} /> : t.accept}
                </button>
              </label>
            </section>
          </details>
        </>
      ) : null}

      {isChatConnected ? <section className="panel chat-panel">
        <div className="section-head">
          <ConnectedUsers peers={visiblePeers} emptyText={t.noConnectedUsers} localPeerId={localPeerId} onMention={mentionPeer} />
          <div className="chat-head-actions">
            <button type="button" className="secondary invite-current-button" onClick={() => void createInviteOfferBundle('current')} disabled={!hasNickname || isSignalBusy}>
              {creatingMode === 'current' ? <LoadingLabel label={t.inviteToCurrent} /> : t.inviteToCurrent}
            </button>
            <button
              type="button"
              className="mention-bell"
              onClick={() => void openNextMention()}
              disabled={unreadMentionIds.length === 0}
              title="Mentions"
              aria-label="Mentions"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                <path d="M10 21h4" />
              </svg>
              {unreadMentionIds.length > 0 ? <strong>{unreadMentionIds.length}</strong> : null}
            </button>
            <button type="button" className="secondary disconnect-button" onClick={() => void stopChat()}>{t.disconnect}</button>
          </div>
        </div>
        {chatInviteSetupOpen ? (
          <details className="advanced connection-setup chat-invite-setup" open onToggle={(event) => setChatInviteSetupOpen(event.currentTarget.open)}>
            <summary>
              <span>{t.connectionSetup}</span>
              <small>{setupStatus}</small>
            </summary>
            <section className="advanced-section setup-grid">
              <label>
                <span>{t.sendToUser}</span>
                <textarea value={manualSignalOut} readOnly placeholder={t.sendPlaceholder} />
              </label>
              <label>
                <span>{t.pasteReply}</span>
                <textarea value={manualSignalIn} onChange={(event) => {
                  setManualSignalIn(event.target.value)
                  if (event.target.value.trim()) setChatInviteSetupOpen(true)
                }} placeholder={t.pastePlaceholder} />
                <button type="button" onClick={() => void acceptManualSignal()} disabled={!hasNickname || !manualSignalIn.trim() || isSignalBusy}>
                  {acceptingSignal ? <LoadingLabel label={t.accept} /> : t.accept}
                </button>
              </label>
            </section>
          </details>
        ) : null}
        {status ? <p className="status-line chat-status-line">{status}</p> : null}
        <ChatView
          messages={chatMessages}
          emptyText={t.noMessages}
          localPeerId={localPeerId}
          jumpToMessageId={jumpToMessageId}
          jumpRequest={jumpRequest}
          unreadMentionIds={unreadMentionIds}
          replyLabel={t.reply}
          onReply={replyToMessage}
        />
        {selectedImage ? (
          <div className="image-preview">
            <img src={selectedImage.dataUrl} alt={selectedImage.name || t.attachImage} />
            <button type="button" className="secondary remove-image" onClick={() => setSelectedImage(undefined)}>
              {t.removeImage}
            </button>
          </div>
        ) : null}
        <div className="chat-compose">
          <input
            ref={imageInputRef}
            className="image-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleImageInput}
          />
          <button
            type="button"
            className="attach-image"
            onClick={() => imageInputRef.current?.click()}
            disabled={!hasNickname || imageBusy}
            title={t.attachImage}
            aria-label={t.attachImage}
          >
            <ImageIcon />
          </button>
          <textarea
            ref={chatTextRef}
            value={chatText}
            onChange={(event) => setChatText(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendChatMessage()
              }
            }}
            placeholder={t.typeMessage}
            disabled={!hasNickname}
          />
          <button type="button" onClick={() => void sendChatMessage()} disabled={!hasNickname || imageBusy || (!chatText.trim() && selectedImage == null)}>{t.send}</button>
        </div>
      </section> : null}

      <details className="panel advanced live-logs-panel" hidden>
        <summary>{t.liveLogs}</summary>
        <section className="advanced-section">
          <LogView logs={logs} emptyText={t.noLogs} />
        </section>
      </details>
    </main>
  )
}

function encodeInviteOfferBundle(bundle: InviteOfferBundle): string {
  return `p2p-chat.${bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, ...bundle })))}`
}

class ImageTooLargeError extends Error {}

async function prepareImageAttachment(file: File): Promise<ChatImageAttachment> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context == null) throw new Error('Canvas context is not available.')
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await canvasToBlob(canvas, IMAGE_OUTPUT_TYPE, IMAGE_OUTPUT_QUALITY)
    const dataUrl = await blobToDataUrl(blob)
    if (new TextEncoder().encode(dataUrl).byteLength > IMAGE_MAX_DATA_URL_BYTES) {
      throw new ImageTooLargeError(`${Math.round(dataUrl.length / 1024)} KB`)
    }
    return {
      dataUrl,
      mimeType: blob.type || IMAGE_OUTPUT_TYPE,
      name: file.name || undefined,
      width,
      height,
      size: blob.size
    }
  } finally {
    bitmap.close()
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob == null) reject(new Error('Canvas export failed.'))
      else resolve(blob)
    }, type, quality)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('File read failed.'))
    reader.readAsDataURL(blob)
  })
}

function encodeAnswerBundle(signal: string, peerName?: string): string {
  return `p2p-chat-answer.${bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, signal, peerName })))}`
}

function decodeInviteSignalInput(value: string): { invite?: string; signal: string; chatName?: string; peerName?: string } {
  const normalized = value.trim()
  if (normalized.startsWith('p2p-chat.')) {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(normalized.slice('p2p-chat.'.length)))) as Partial<InviteOfferBundle>
    if (!payload.invite || !payload.signal) throw new Error('Invite+offer bundle is malformed.')
    return { invite: payload.invite, signal: payload.signal, chatName: payload.chatName, peerName: payload.peerName }
  }
  if (normalized.startsWith('p2p-chat-answer.')) {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(normalized.slice('p2p-chat-answer.'.length)))) as { signal?: string; peerName?: string }
    if (!payload.signal) throw new Error('Answer bundle is malformed.')
    return { signal: payload.signal, peerName: payload.peerName }
  }
  return { signal: normalized }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function ImageIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8" cy="10" r="1.5" />
      <path d="m21 15-5-5L5 19" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="theme-icon">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="theme-icon moon">
      <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a7 7 0 1 0 11 11Z" />
    </svg>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
