const DATABASE_NAME = 'mini-device-proof';
const DATABASE_VERSION = 1;
const KEY_STORE = 'proof-keys';

export type ProofChallenge = {
    proof_required: boolean;
    challenge_id?: string;
    challenge?: string;
    purpose?: 'ENROLLMENT' | 'LOGIN' | 'REFRESH';
    branch_id?: number;
    registered_device_id?: number;
    device_id?: string;
    proof_key_thumbprint?: string;
    proof_key_version?: number;
    origin?: string;
    issued_at?: number;
    expires_at?: number;
    ath?: string;
};

export type StoredDeviceProofKey = {
    deviceId: string;
    privateKey: CryptoKey;
    publicKeyJwk: JsonWebKey;
    thumbprint: string;
    createdAt: string;
};

export class DeviceProofError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'DeviceProofError';
        this.code = code;
    }
}

const base64Url = (bytes: Uint8Array): string => {
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const encodeJson = (value: unknown): string =>
    base64Url(new TextEncoder().encode(JSON.stringify(value)));

const sha256Base64Url = async (value: string): Promise<string> =>
    base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));

const canonicalPublicJwk = (jwk: JsonWebKey): JsonWebKey => {
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || jwk.d) {
        throw new DeviceProofError(
            'DEVICE_PROOF_PUBLIC_KEY_INVALID',
            'تعذر إنشاء مفتاح إثبات آمن لهذا الجهاز.',
        );
    }
    return { crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y };
};

export const computePublicJwkThumbprint = async (jwk: JsonWebKey): Promise<string> => {
    const canonical = canonicalPublicJwk(jwk);
    const serialized = JSON.stringify({
        crv: canonical.crv,
        kty: canonical.kty,
        x: canonical.x,
        y: canonical.y,
    });
    return sha256Base64Url(serialized);
};

const ensureCryptoSupport = (): void => {
    if (!window.isSecureContext || !window.crypto?.subtle || !window.indexedDB) {
        throw new DeviceProofError(
            'DEVICE_PROOF_STORAGE_UNAVAILABLE',
            'تفعيل الجهاز يحتاج متصفحاً عادياً واتصال HTTPS. الوضع الخاص غير مدعوم.',
        );
    }
};

const openDatabase = (): Promise<IDBDatabase> => {
    ensureCryptoSupport();
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(KEY_STORE)) {
                database.createObjectStore(KEY_STORE, { keyPath: 'deviceId' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new DeviceProofError(
            'DEVICE_PROOF_STORAGE_UNAVAILABLE',
            'تعذر فتح مخزن مفتاح الجهاز. استخدم الوضع العادي للمتصفح.',
        ));
        request.onblocked = () => reject(new DeviceProofError(
            'DEVICE_PROOF_STORAGE_UNAVAILABLE',
            'مخزن مفتاح الجهاز محجوب بواسطة المتصفح.',
        ));
    });
};

const writeStoredKey = async (record: StoredDeviceProofKey): Promise<void> => {
    const database = await openDatabase();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(KEY_STORE, 'readwrite');
            transaction.objectStore(KEY_STORE).put(record);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(new DeviceProofError(
                'DEVICE_PROOF_STORAGE_UNAVAILABLE',
                'تعذر حفظ مفتاح الجهاز بشكل دائم. لا تستخدم الوضع الخاص.',
            ));
            transaction.onabort = () => reject(new DeviceProofError(
                'DEVICE_PROOF_STORAGE_UNAVAILABLE',
                'أوقف المتصفح حفظ مفتاح الجهاز.',
            ));
        });
    } finally {
        database.close();
    }
};

export const loadDeviceProofKey = async (deviceId: string): Promise<StoredDeviceProofKey | null> => {
    const database = await openDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const request = database.transaction(KEY_STORE, 'readonly').objectStore(KEY_STORE).get(deviceId);
            request.onsuccess = () => resolve((request.result as StoredDeviceProofKey | undefined) ?? null);
            request.onerror = () => reject(new DeviceProofError(
                'DEVICE_PROOF_STORAGE_UNAVAILABLE',
                'تعذر قراءة مفتاح إثبات الجهاز.',
            ));
        });
    } finally {
        database.close();
    }
};

export const generateAndStoreDeviceProofKey = async (
    deviceId: string,
): Promise<StoredDeviceProofKey> => {
    ensureCryptoSupport();
    let pair: CryptoKeyPair;
    try {
        pair = await crypto.subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['sign', 'verify'],
        ) as CryptoKeyPair;
    } catch {
        throw new DeviceProofError(
            'DEVICE_PROOF_KEY_GENERATION_FAILED',
            'هذا المتصفح لا يستطيع إنشاء مفتاح الجهاز الآمن.',
        );
    }
    if (pair.privateKey.extractable) {
        throw new DeviceProofError(
            'DEVICE_PROOF_PRIVATE_KEY_EXPORTABLE',
            'رفض المتصفح إنشاء مفتاح خاص غير قابل للتصدير.',
        );
    }
    const publicKeyJwk = canonicalPublicJwk(await crypto.subtle.exportKey('jwk', pair.publicKey));
    const record: StoredDeviceProofKey = {
        deviceId,
        privateKey: pair.privateKey,
        publicKeyJwk,
        thumbprint: await computePublicJwkThumbprint(publicKeyJwk),
        createdAt: new Date().toISOString(),
    };
    await writeStoredKey(record);
    const persisted = await loadDeviceProofKey(deviceId);
    if (!persisted?.privateKey || persisted.privateKey.extractable) {
        throw new DeviceProofError(
            'DEVICE_PROOF_STORAGE_UNAVAILABLE',
            'لم يتمكن المتصفح من حفظ مفتاح الجهاز بصورة دائمة.',
        );
    }
    return persisted;
};

const signJws = async (
    key: StoredDeviceProofKey,
    typ: 'mini-device-proof+jwt' | 'dpop+jwt',
    payload: Record<string, unknown>,
): Promise<string> => {
    const protectedHeader = encodeJson({
        typ,
        alg: 'ES256',
        jwk: canonicalPublicJwk(key.publicKeyJwk),
    });
    const encodedPayload = encodeJson(payload);
    let signature: ArrayBuffer;
    try {
        signature = await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            key.privateKey,
            new TextEncoder().encode(`${protectedHeader}.${encodedPayload}`),
        );
    } catch {
        throw new DeviceProofError(
            'DEVICE_PROOF_SIGNING_FAILED',
            'تعذر استخدام مفتاح الجهاز. اطلب من الإدارة إعادة الربط.',
        );
    }
    return `${protectedHeader}.${encodedPayload}.${base64Url(new Uint8Array(signature))}`;
};

const requireChallenge = (challenge: ProofChallenge): Required<Omit<ProofChallenge, 'ath'>> & { ath?: string } => {
    if (
        !challenge.proof_required || !challenge.challenge_id || !challenge.challenge ||
        !challenge.purpose || !challenge.branch_id || !challenge.registered_device_id ||
        !challenge.device_id || !challenge.proof_key_thumbprint ||
        !challenge.proof_key_version || !challenge.origin || !challenge.expires_at
    ) {
        throw new DeviceProofError('DEVICE_PROOF_CHALLENGE_INVALID', 'استجابة تحدي الجهاز غير مكتملة.');
    }
    return challenge as Required<Omit<ProofChallenge, 'ath'>> & { ath?: string };
};

export const createChallengeAssertion = async (
    challengeValue: ProofChallenge,
    key: StoredDeviceProofKey,
): Promise<string> => {
    const challenge = requireChallenge(challengeValue);
    if (challenge.device_id !== key.deviceId || challenge.proof_key_thumbprint !== key.thumbprint) {
        throw new DeviceProofError(
            'DEVICE_PROOF_KEY_MISMATCH',
            'مفتاح هذا المتصفح لا يطابق الجهاز المسجل. يجب إعادة الربط.',
        );
    }
    return signJws(key, 'mini-device-proof+jwt', {
        challenge_id: challenge.challenge_id,
        challenge: challenge.challenge,
        purpose: challenge.purpose,
        branch_id: challenge.branch_id,
        registered_device_id: challenge.registered_device_id,
        device_id: challenge.device_id,
        jkt: key.thumbprint,
        key_version: challenge.proof_key_version,
        origin: challenge.origin,
        iat: Math.floor(Date.now() / 1000),
        exp: challenge.expires_at,
        ...(challenge.ath ? { ath: challenge.ath } : {}),
    });
};

type JwtPayload = {
    cnf?: { jkt?: string };
    device_proof_key_version?: number;
};

const parseJwtPayload = (token: string): JwtPayload => {
    try {
        const encoded = token.split('.')[1];
        const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
        return JSON.parse(decoded) as JwtPayload;
    } catch {
        return {};
    }
};

export const tokenRequiresDeviceProof = (token: string | null): boolean =>
    Boolean(token && parseJwtPayload(token).cnf?.jkt);

export const createDpopProof = async (
    token: string,
    deviceId: string,
    method: string,
    requestUrl: string,
): Promise<string> => {
    const payload = parseJwtPayload(token);
    const expectedThumbprint = payload.cnf?.jkt;
    if (!expectedThumbprint) {
        throw new DeviceProofError('DEVICE_PROOF_SESSION_MISMATCH', 'الجلسة غير مربوطة بمفتاح جهاز.');
    }
    const key = await loadDeviceProofKey(deviceId);
    if (!key) {
        throw new DeviceProofError(
            'DEVICE_PROOF_KEY_MISSING',
            'مفتاح الجهاز غير موجود في هذا المتصفح. اطلب من الإدارة إعادة الربط.',
        );
    }
    if (key.thumbprint !== expectedThumbprint) {
        throw new DeviceProofError(
            'DEVICE_PROOF_KEY_MISMATCH',
            'مفتاح هذا المتصفح لا يطابق الجلسة. اطلب من الإدارة إعادة الربط.',
        );
    }
    const url = new URL(requestUrl, window.location.origin);
    const htu = `${url.protocol}//${url.host}${url.pathname}`;
    const jti = crypto.randomUUID
        ? crypto.randomUUID()
        : base64Url(crypto.getRandomValues(new Uint8Array(18)));
    return signJws(key, 'dpop+jwt', {
        jti,
        htm: method.toUpperCase(),
        htu,
        iat: Math.floor(Date.now() / 1000),
        ath: await sha256Base64Url(token),
    });
};

export const loadRequiredDeviceProofKey = async (
    deviceId: string,
    expectedThumbprint?: string,
): Promise<StoredDeviceProofKey> => {
    const key = await loadDeviceProofKey(deviceId);
    if (!key) {
        throw new DeviceProofError(
            'DEVICE_PROOF_KEY_MISSING',
            'مفتاح الجهاز غير موجود. لا يمكن استبداله تلقائياً؛ اطلب إعادة الربط من الإدارة.',
        );
    }
    if (expectedThumbprint && key.thumbprint !== expectedThumbprint) {
        throw new DeviceProofError('DEVICE_PROOF_KEY_MISMATCH', 'مفتاح الجهاز المحلي لا يطابق السجل.');
    }
    return key;
};
