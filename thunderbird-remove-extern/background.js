// ============================================================
// Remove [EXTERN] Prefix - Thunderbird MailExtension
// ============================================================
// Entfernt automatisch das "[EXTERN] " Präfix aus E-Mail-Betreffs.
// Funktioniert bei eingehenden Nachrichten (automatisch) und
// über das Rechtsklick-Kontextmenü (manuell).
//
// WICHTIG: Alle Manipulationen an der Roh-Nachricht erfolgen auf
// Byte-Ebene (Uint8Array). Nur der Header-Bereich wird als Latin-1
// (byte-transparent) gelesen/geschrieben. Der Body wird NIEMALS
// dekodiert oder re-kodiert, um Encoding-Probleme zu vermeiden.
// ============================================================

const LOG = "[Remove EXTERN]";

/**
 * Konfiguration: Muster die aus dem DEKODIERTEN Betreff entfernt werden.
 * message.subject liefert den bereits dekodierten (Klartext-)Betreff.
 */
const PATTERNS_TO_REMOVE = [
  /\[EXTERN\][ \t]*/gi,
  // Weitere Muster hier hinzufügen, z.B.:
  // /\[EXTERNAL\][ \t]*/gi,
  // /\[EXT\][ \t]*/gi,
];

// ============================================================
// Hilfsfunktionen
// ============================================================

/**
 * Prüft ob der (dekodierte) Betreff ein zu entfernendes Präfix enthält.
 */
function subjectHasPrefix(subject) {
  if (!subject) return false;
  return PATTERNS_TO_REMOVE.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(subject);
  });
}

/**
 * Entfernt das [EXTERN]-Muster aus einem dekodierten Betreff.
 */
function cleanSubject(subject) {
  let cleaned = subject;
  for (const pattern of PATTERNS_TO_REMOVE) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.trim();
}

/**
 * Kodiert einen Betreff als RFC 2047 Quoted-Printable, falls nötig.
 * Reine ASCII-Betreffs werden unverändert zurückgegeben.
 */
function encodeSubjectRFC2047(subject) {
  if (/^[\x20-\x7E]*$/.test(subject)) {
    return subject;
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(subject);
  const maxChunkLen = 45;
  const chunks = [];
  let currentChunk = "";
  let currentLen = 0;

  for (const byte of bytes) {
    let encoded;
    if (
      byte >= 0x21 && byte <= 0x7e &&
      byte !== 0x3f && byte !== 0x3d && byte !== 0x5f
    ) {
      encoded = String.fromCharCode(byte);
    } else if (byte === 0x20) {
      encoded = "_";
    } else {
      encoded = "=" + byte.toString(16).toUpperCase().padStart(2, "0");
    }

    if (currentLen + encoded.length > maxChunkLen && currentChunk) {
      chunks.push("=?UTF-8?Q?" + currentChunk + "?=");
      currentChunk = encoded;
      currentLen = encoded.length;
    } else {
      currentChunk += encoded;
      currentLen += encoded.length;
    }
  }
  if (currentChunk) {
    chunks.push("=?UTF-8?Q?" + currentChunk + "?=");
  }

  return chunks.join("\r\n ");
}

// ============================================================
// Byte-Level Nachrichtenverarbeitung
// ============================================================

/**
 * Liest die Roh-Nachricht als Uint8Array (Bytes).
 * Vermeidet jegliche Text-Dekodierung des Body.
 */
async function getRawMessageBytes(messageId) {
  const rawData = await messenger.messages.getRaw(messageId);

  if (typeof rawData === "string") {
    // TB <120: Binary String → jedes Zeichen = 1 Byte
    const bytes = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      bytes[i] = rawData.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  // TB ≥120: File-Objekt → ArrayBuffer → Uint8Array
  return new Uint8Array(await rawData.arrayBuffer());
}

/**
 * Findet die Position der Header/Body-Grenze in den rohen Bytes.
 * Die Grenze ist die erste Leerzeile (\r\n\r\n oder \n\n).
 *
 * @returns {{ headerEnd: number, bodyStart: number, lineEnding: string }}
 *   headerEnd: Index des letzten Header-Bytes (vor der Leerzeile)
 *   bodyStart: Index des ersten Body-Bytes (nach der Leerzeile)
 *   lineEnding: "\r\n" oder "\n"
 */
function findHeaderBodyBoundary(rawBytes) {
  // Suche \r\n\r\n
  for (let i = 0; i < rawBytes.length - 3; i++) {
    if (
      rawBytes[i] === 0x0d &&     // \r
      rawBytes[i + 1] === 0x0a && // \n
      rawBytes[i + 2] === 0x0d && // \r
      rawBytes[i + 3] === 0x0a    // \n
    ) {
      return { headerEnd: i, bodyStart: i + 4, lineEnding: "\r\n" };
    }
  }

  // Fallback: \n\n (manche Server)
  for (let i = 0; i < rawBytes.length - 1; i++) {
    if (rawBytes[i] === 0x0a && rawBytes[i + 1] === 0x0a) {
      return { headerEnd: i, bodyStart: i + 2, lineEnding: "\n" };
    }
  }

  return null;
}

/**
 * Ersetzt den Subject-Header in der rohen Nachricht auf Byte-Ebene.
 *
 * 1. Header-Bereich als Latin-1 dekodieren (byte-transparent, da Header
 *    nur 7-bit ASCII + RFC 2047 encoded words enthalten)
 * 2. Subject-Zeile(n) finden und durch neuen Betreff ersetzen
 * 3. Modifizierten Header als Bytes zurückschreiben
 * 4. Body-Bytes UNVERÄNDERT anhängen
 *
 * @param {Uint8Array} rawBytes - Rohe Nachricht als Bytes
 * @param {string} newSubject - Neuer (dekodierter) Betreff
 * @returns {Uint8Array|null} - Modifizierte Nachricht als Bytes
 */
function replaceSubjectInRawBytes(rawBytes, newSubject) {
  const boundary = findHeaderBodyBoundary(rawBytes);
  if (!boundary) {
    console.warn(LOG, "Keine Header/Body-Grenze gefunden.");
    return null;
  }

  const { headerEnd, bodyStart, lineEnding } = boundary;

  // ── Header als Latin-1 dekodieren ──
  // Latin-1 = jedes Byte wird 1:1 zu einem Unicode-Codepoint (U+0000..U+00FF).
  // Das ist sicher für Header, da diese 7-bit ASCII + RFC 2047 sind.
  const headerBytes = rawBytes.slice(0, headerEnd);
  const headerStr = new TextDecoder("latin1").decode(headerBytes);
  const headerLines = headerStr.split(lineEnding);

  // ── Subject-Header finden ──
  let subjectStart = -1;
  let subjectEnd = -1;

  for (let i = 0; i < headerLines.length; i++) {
    if (/^Subject:\s?/i.test(headerLines[i])) {
      subjectStart = i;
      subjectEnd = i + 1;
      // Fortsetzungszeilen (beginnen mit Whitespace)
      while (
        subjectEnd < headerLines.length &&
        /^[ \t]/.test(headerLines[subjectEnd])
      ) {
        subjectEnd++;
      }
      break;
    }
  }

  if (subjectStart === -1) {
    console.warn(LOG, "Kein Subject-Header gefunden.");
    return null;
  }

  // ── Neuen Subject-Header einfügen ──
  const encodedSubject = encodeSubjectRFC2047(newSubject);
  const newSubjectLine = "Subject: " + encodedSubject;
  headerLines.splice(subjectStart, subjectEnd - subjectStart, newSubjectLine);

  // ── Modifizierten Header als Bytes kodieren ──
  // Da der neue Subject RFC 2047 Q-Encoded ist (= reines ASCII) und der
  // Rest der Header unverändert bleibt, ist Latin-1 Encoding sicher.
  const newHeaderStr = headerLines.join(lineEnding);
  const newHeaderBytes = new Uint8Array(newHeaderStr.length);
  for (let i = 0; i < newHeaderStr.length; i++) {
    newHeaderBytes[i] = newHeaderStr.charCodeAt(i) & 0xff;
  }

  // ── Leerzeile zwischen Header und Body ──
  const separatorBytes =
    lineEnding === "\r\n"
      ? new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a])
      : new Uint8Array([0x0a, 0x0a]);

  // ── Body-Bytes (UNVERÄNDERT!) ──
  const bodyBytes = rawBytes.slice(bodyStart);

  // ── Zusammenbauen ──
  const result = new Uint8Array(
    newHeaderBytes.length + separatorBytes.length + bodyBytes.length
  );
  result.set(newHeaderBytes, 0);
  result.set(separatorBytes, newHeaderBytes.length);
  result.set(bodyBytes, newHeaderBytes.length + separatorBytes.length);

  console.log(
    LOG,
    `Header: ${headerBytes.length} → ${newHeaderBytes.length} Bytes,`,
    `Body: ${bodyBytes.length} Bytes (unverändert)`
  );

  return result;
}

/**
 * Gibt die Folder-ID zurück (kompatibel mit TB 115-121+).
 */
function getFolderId(folder) {
  if (typeof folder.id === "string" || typeof folder.id === "number") {
    return folder.id;
  }
  return folder;
}

/**
 * Verarbeitet eine einzelne Nachricht auf Byte-Ebene.
 *
 * Ablauf:
 * 1. Roh-Nachricht als Bytes laden
 * 2. Subject-Header ersetzen (nur Header-Bytes, Body unberührt)
 * 3. Original in Papierkorb verschieben (nötig wegen Message-ID-Duplikat)
 * 4. Modifizierte Nachricht importieren
 * 5. Bei Fehler: Original aus gesicherten Bytes wiederherstellen
 */
async function processMessage(message, folder) {
  if (!subjectHasPrefix(message.subject)) return false;

  const newSubject = cleanSubject(message.subject);
  console.log(LOG, "Verarbeite:", message.subject, "→", newSubject);

  // ── Roh-Nachricht als Bytes laden ──
  let rawBytes;
  try {
    rawBytes = await getRawMessageBytes(message.id);
    console.log(LOG, "Roh-Nachricht geladen:", rawBytes.length, "Bytes");
  } catch (err) {
    console.error(LOG, "Roh-Nachricht konnte nicht geladen werden:", err);
    return false;
  }

  // ── Subject im Header ersetzen (Body bleibt byte-identisch!) ──
  const modifiedBytes = replaceSubjectInRawBytes(rawBytes, newSubject);
  if (!modifiedBytes) {
    console.warn(LOG, "Subject-Ersetzung fehlgeschlagen für:", message.subject);
    return false;
  }

  // Nachrichts-Eigenschaften übernehmen
  const properties = {};
  if (message.read !== undefined) properties.read = message.read;
  if (message.flagged !== undefined) properties.flagged = message.flagged;
  if (message.junk !== undefined) properties.junk = message.junk;
  if (message.tags && message.tags.length > 0) properties.tags = message.tags;

  const folderId = getFolderId(folder);

  // ── Schritt 1: Original in Papierkorb ──
  try {
    // Markiere als gelesen vor dem Verschieben in den Papierkorb
    await messenger.messages.update(message.id, { read: true });
    await messenger.messages.delete([message.id], false);
    console.log(LOG, "Original als gelesen markiert und in Papierkorb verschoben:", message.id);
  } catch (deleteErr) {
    console.error(LOG, "Original konnte nicht gelöscht werden:", deleteErr);
    return false;
  }

  // ── Schritt 2: Modifizierte Nachricht importieren ──
  // WICHTIG: new File([Uint8Array]) übernimmt die Bytes 1:1 ohne Encoding!
  try {
    const file = new File([modifiedBytes], "message.eml", {
      type: "message/rfc822",
    });
    const imported = await messenger.messages.import(file, folderId, properties);
    console.log(LOG, "Import erfolgreich:", imported?.id, "–", newSubject);
    return true;
  } catch (importErr) {
    console.error(LOG, "Import fehlgeschlagen:", importErr);

    // ── Notfall: Original aus gesicherten Bytes wiederherstellen ──
    console.warn(LOG, "Versuche Original wiederherzustellen...");
    try {
      const origFile = new File([rawBytes], "original.eml", {
        type: "message/rfc822",
      });
      await messenger.messages.import(origFile, folderId, properties);
      console.log(LOG, "Original wiederhergestellt.");
    } catch (restoreErr) {
      console.error(
        LOG,
        "WARNUNG: Original konnte NICHT wiederhergestellt werden!",
        "Es liegt im Papierkorb und kann manuell zurückverschoben werden.",
        restoreErr
      );
    }
    return false;
  }
}

// ============================================================
// Automatische Verarbeitung eingehender Nachrichten
// ============================================================

messenger.messages.onNewMailReceived.addListener(async (folder, messageList) => {
  console.log(
    LOG,
    `Neue Mail(s) in "${folder.name}":`,
    messageList.messages.length,
    "Nachricht(en)"
  );

  // Kurz warten, damit IMAP die Nachricht vollständig synchronisiert hat
  await new Promise((r) => setTimeout(r, 1500));

  let count = 0;
  for (const message of messageList.messages) {
    try {
      // Nachricht neu laden – sie könnte nach dem Delay verschoben worden sein
      const freshMessage = await messenger.messages.get(message.id);
      if (freshMessage?.folder) {
        const targetFolder = freshMessage.folder;
        if (await processMessage(freshMessage, targetFolder)) {
          count++;
        }
      }
    } catch (err) {
      // Nachricht existiert möglicherweise nicht mehr (z.B. durch Filter verschoben)
      console.log(LOG, "Nachricht", message.id, "nicht mehr verfügbar:", err.message);
    }
  }
  if (count > 0) {
    console.log(LOG, `${count} neue Nachricht(en) verarbeitet.`);
  }
});

// ============================================================
// Kontextmenü für manuelle Verarbeitung
// ============================================================

messenger.menus.create({
  id: "remove-extern-selected",
  title: "[EXTERN] Präfix entfernen",
  contexts: ["message_list"],
});

messenger.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "remove-extern-selected") return;
  if (!info.selectedMessages) return;

  let count = 0;
  let page = info.selectedMessages;

  while (page) {
    for (const message of page.messages) {
      try {
        // Nachricht frisch laden für aktuelle Daten und Folder
        const freshMessage = await messenger.messages.get(message.id);
        if (freshMessage?.folder) {
          if (await processMessage(freshMessage, freshMessage.folder)) {
            count++;
          }
        }
      } catch (err) {
        console.warn(LOG, "Nachricht", message.id, "Fehler:", err.message);
      }
    }
    if (page.id) {
      page = await messenger.messages.continueList(page.id);
    } else {
      break;
    }
  }

  if (count > 0) {
    console.log(LOG, `${count} Nachricht(en) manuell verarbeitet.`);
  }
});

// ============================================================
console.log(LOG, "Extension erfolgreich geladen. Thunderbird Version:", navigator.userAgent);
