/* The linked export stays on this device. Only its handle and last successful file stamp are persisted here. */
window.WatchFileSync = (() => {
  "use strict";

  const readAccess = { mode: "read" };
  const pollInterval = 15000;

  async function linkStore(mode, operation) {
    const db = await new Promise((resolve, reject) => {
      const open = window.indexedDB.open("watch-upgrade-file-link", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("links");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("links", mode);
        const request = operation(transaction.objectStore("links"));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error || request.error);
        transaction.onerror = () => reject(transaction.error || request.error);
      });
    } finally {
      db.close();
    }
  }

  function create({ onFile, onStatus = () => {} }) {
    const supported = typeof window.showOpenFilePicker === "function";
    let handle = null;
    let stamp = null;
    let intent = 0;
    let timer = null;
    let pending = null;
    let queue = Promise.resolve();
    let temporary = false;
    let lastStatus = {};

    function status(state, message) {
      const name = handle?.name || "";
      if (lastStatus.state === state && lastStatus.name === name && lastStatus.message === message) return;
      lastStatus = { state, name, message };
      onStatus(lastStatus);
    }

    function enqueue(work) {
      const result = queue.then(work);
      queue = result.catch(() => {});
      return result;
    }

    function checkVisible() {
      if (handle && !document.hidden) check();
    }

    function setHandle(next, lastStamp = null) {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkVisible);
      handle = next;
      stamp = lastStamp;
      timer = null;
      if (handle) {
        timer = window.setInterval(checkVisible, pollInterval);
        document.addEventListener("visibilitychange", checkVisible);
      }
    }

    async function save() {
      const entry = handle ? { handle, stamp } : null;
      try {
        await linkStore("readwrite", store => entry ? store.put(entry, "export") : store.delete("export"));
        temporary = false;
      } catch {
        temporary = true;
      }
    }

    function watching() {
      status("watching", temporary
        ? "Archivo vinculado durante esta sesión. Se comprueba mientras la página está visible."
        : "Vínculo activo. Se comprueban los cambios mientras la página está visible.");
    }

    function reportError(error) {
      if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
        status("permission", "El navegador necesita permiso para leer el archivo vinculado.");
      } else if (error?.name === "NotFoundError") {
        status("error", "El archivo se ha movido o eliminado. Vuelve a vincular la exportación.");
      } else {
        status("error", error?.message || "No se pudo leer el archivo vinculado.");
      }
    }

    function check() {
      if (!handle) return Promise.resolve();
      const current = handle;
      if (pending?.handle === current) return pending.promise;
      const promise = enqueue(async () => {
        if (current !== handle) return;
        try {
          const permission = await current.queryPermission(readAccess);
          if (current !== handle) return;
          if (permission !== "granted") {
            status("permission", "Vuelve a dar permiso para leer el archivo vinculado.");
            return;
          }
          const file = await current.getFile();
          if (current !== handle) return;
          const nextStamp = file.lastModified + ":" + file.size;
          if (stamp !== nextStamp) {
            status("reading", "Leyendo los cambios del archivo…");
            await onFile(file);
            if (current !== handle) return;
            stamp = nextStamp;
            await save();
          }
          if (current === handle) watching();
        } catch (error) {
          if (current === handle) reportError(error);
        }
      }).finally(() => {
        if (pending?.promise === promise) pending = null;
      });
      pending = { handle: current, promise };
      return promise;
    }

    async function restore({ hasData = false } = {}) {
      if (!supported) {
        status("unsupported", "Puedes actualizar los datos importando otra exportación.");
        return;
      }
      const request = ++intent;
      let entry;
      try {
        entry = await linkStore("readonly", store => store.get("export"));
      } catch {
        // A private or storage-restricted browser can still monitor a file for this session.
      }
      if (request !== intent) return;
      if (entry?.handle?.kind === "file") {
        setHandle(entry.handle, hasData ? entry.stamp : null);
        await check();
      } else {
        status("idle", "Puedes vincular un XML para detectar sus cambios.");
      }
    }

    async function choose() {
      if (!supported) {
        status("unsupported", "Puedes actualizar los datos importando otra exportación.");
        return;
      }
      const request = ++intent;
      try {
        const [selected] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: "Exportación XML de Salud", accept: { "application/xml": [".xml"] } }]
        });
        if (request !== intent || !selected) return;
        setHandle(selected);
        await enqueue(save);
        if (handle === selected) await check();
      } catch (error) {
        if (request !== intent || error?.name === "AbortError") return;
        status("error", "El navegador no pudo abrir el selector. Usa la importación manual.");
      }
    }

    async function reconnect() {
      if (!handle) return choose();
      const current = handle;
      try {
        await current.requestPermission(readAccess);
        if (handle === current) await check();
      } catch (error) {
        if (handle === current) reportError(error);
      }
    }

    async function disconnect() {
      ++intent;
      setHandle(null);
      await enqueue(save);
      if (!handle) status("idle", temporary
        ? "Vínculo cerrado en esta sesión. No se pudo actualizar el almacenamiento local."
        : "Archivo desvinculado.");
    }

    return { supported, restore, choose, reconnect, disconnect, check };
  }

  return { create };
})();
