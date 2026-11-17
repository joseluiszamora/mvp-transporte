import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

const _refreshSessionKey = 'mvp.refreshSession';

class ApiException implements Exception {
  const ApiException(this.statusCode, this.code, this.message);

  final int statusCode;
  final String code;
  final String message;

  @override
  String toString() => message;
}

class OrganizationOption {
  const OrganizationOption({required this.id, required this.name});

  final String id;
  final String name;

  factory OrganizationOption.fromJson(Map<String, dynamic> value) =>
      OrganizationOption(
        id: value['id'] as String,
        name: value['name'] as String,
      );
}

class DriverSession {
  const DriverSession({
    required this.accessToken,
    required this.accessTokenExpiresAt,
    required this.organizations,
    required this.selectedOrganizationId,
    required this.displayName,
  });

  final String accessToken;
  final DateTime accessTokenExpiresAt;
  final List<OrganizationOption> organizations;
  final String? selectedOrganizationId;
  final String displayName;
}

class BaseAuthClient {
  BaseAuthClient({http.Client? httpClient, FlutterSecureStorage? storage})
    : _http = httpClient ?? http.Client(),
      _storage = storage ?? FlutterSecureStorage(),
      _baseApiUrl = _withTrailingSlash(
        Uri.parse(
          const String.fromEnvironment(
            'MVP_BASE_API_URL',
            defaultValue: 'http://10.0.2.2:4000/api/v1/',
          ),
        ),
      ),
      _transportApiUrl = _withTrailingSlash(
        Uri.parse(
          const String.fromEnvironment(
            'MVP_TRANSPORT_API_URL',
            defaultValue: 'http://10.0.2.2:4100/api/v1/transport/',
          ),
        ),
      ),
      _mobileOrigin = const String.fromEnvironment(
        'MVP_BASE_MOBILE_ORIGIN',
        defaultValue: 'https://mobile.mvp-transporte.local',
      );

  final http.Client _http;
  final FlutterSecureStorage _storage;
  final Uri _baseApiUrl;
  final Uri _transportApiUrl;
  final String _mobileOrigin;
  DriverSession? _session;
  Future<void>? _refreshInProgress;

  DriverSession? get session => _session;

  Future<DriverSession?> restoreSession() async {
    final credentials = await _readRefreshCredentials();
    if (credentials == null) return null;
    try {
      final response = await _http
          .post(
            _baseApiUrl.resolve('auth/refresh'),
            headers: _csrfHeaders(
              credentials.refreshToken,
              credentials.csrfToken,
            ),
          )
          .timeout(const Duration(seconds: 15));
      if (response.statusCode == 401 || response.statusCode == 403) {
        await _clearSession();
        return null;
      }
      final body = _decodeResponse(response);
      await _saveRotatedCookies(response);
      _session = _sessionFromJson(body);
      return _session;
    } on ApiException catch (error) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        await _clearSession();
        return null;
      }
      rethrow;
    }
  }

  Future<DriverSession> login(String email, String password) async {
    final response = await _http
        .post(
          _baseApiUrl.resolve('auth/login'),
          headers: _baseHeaders(),
          body: jsonEncode({'email': email.trim(), 'password': password}),
        )
        .timeout(const Duration(seconds: 15));
    final body = _decodeResponse(response);
    await _saveRotatedCookies(response);
    _session = _sessionFromJson(body);
    return _session!;
  }

  Future<DriverSession> selectOrganization(String organizationId) async {
    final current = _requireSession();
    final body = await _authorizedBaseRequest(
      'auth/select-organization',
      method: 'POST',
      body: {'organizationId': organizationId},
    );
    final accessToken = body['accessToken'];
    final expiresAt = body['accessTokenExpiresAt'];
    final selectedOrganizationId = body['selectedOrganizationId'];
    if (accessToken is! String ||
        expiresAt is! String ||
        selectedOrganizationId != organizationId) {
      throw const ApiException(
        502,
        'BASE_INVALID_RESPONSE',
        'mvp-base devolvió una sesión no válida.',
      );
    }
    _session = DriverSession(
      accessToken: accessToken,
      accessTokenExpiresAt: DateTime.parse(expiresAt),
      organizations: current.organizations,
      selectedOrganizationId: organizationId,
      displayName: current.displayName,
    );
    return _session!;
  }

  Future<Map<String, dynamic>> transportGet(String path) =>
      _authorizedTransportRequest(path);

  Future<Map<String, dynamic>> transportPatch(
    String path,
    Map<String, dynamic> body,
  ) => _authorizedTransportRequest(path, method: 'PATCH', body: body);

  Future<void> logout() async {
    final current = _session;
    final credentials = await _readRefreshCredentials();
    try {
      if (current != null && credentials != null) {
        await _http
            .post(
              _baseApiUrl.resolve('auth/logout'),
              headers: {
                ..._csrfHeaders(
                  credentials.refreshToken,
                  credentials.csrfToken,
                ),
                'Authorization': 'Bearer ${current.accessToken}',
              },
            )
            .timeout(const Duration(seconds: 15));
      }
    } finally {
      await _clearSession();
    }
  }

  Future<Map<String, dynamic>> _authorizedTransportRequest(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
  }) async {
    await _ensureFreshAccessToken();
    var response = await _sendTransport(path, method, body);
    if (response.statusCode == 401) {
      await _rotateRefreshToken();
      response = await _sendTransport(path, method, body);
      if (response.statusCode == 401) await _invalidateSession();
    }
    return _decodeResponse(response);
  }

  Future<http.Response> _sendTransport(
    String path,
    String method,
    Map<String, dynamic>? body,
  ) {
    final current = _requireSession();
    return _send(_transportApiUrl.resolve(path), method, {
      'Authorization': 'Bearer ${current.accessToken}',
    }, body);
  }

  Future<Map<String, dynamic>> _authorizedBaseRequest(
    String path, {
    required String method,
    Map<String, dynamic>? body,
  }) async {
    await _ensureFreshAccessToken();
    var current = _requireSession();
    var response = await _send(_baseApiUrl.resolve(path), method, {
      ..._baseHeaders(),
      'Authorization': 'Bearer ${current.accessToken}',
    }, body);
    if (response.statusCode == 401) {
      await _rotateRefreshToken();
      current = _requireSession();
      response = await _send(_baseApiUrl.resolve(path), method, {
        ..._baseHeaders(),
        'Authorization': 'Bearer ${current.accessToken}',
      }, body);
      if (response.statusCode == 401) await _invalidateSession();
    }
    return _decodeResponse(response);
  }

  Future<http.Response> _send(
    Uri uri,
    String method,
    Map<String, String> headers,
    Map<String, dynamic>? body,
  ) {
    final encodedBody = body == null ? null : jsonEncode(body);
    final requestHeaders = {
      'Accept': 'application/json',
      if (body != null) 'Content-Type': 'application/json',
      ...headers,
    };
    switch (method) {
      case 'POST':
        return _http
            .post(uri, headers: requestHeaders, body: encodedBody)
            .timeout(const Duration(seconds: 15));
      case 'PATCH':
        return _http
            .patch(uri, headers: requestHeaders, body: encodedBody)
            .timeout(const Duration(seconds: 15));
      default:
        return _http
            .get(uri, headers: requestHeaders)
            .timeout(const Duration(seconds: 15));
    }
  }

  Future<void> _ensureFreshAccessToken() async {
    final current = _requireSession();
    if (current.accessTokenExpiresAt.isAfter(
      DateTime.now().add(const Duration(seconds: 45)),
    ))
      return;
    await _rotateRefreshToken();
  }

  Future<void> _rotateRefreshToken() async {
    final currentRotation = _refreshInProgress;
    if (currentRotation != null) {
      await currentRotation;
      return;
    }
    final rotation = _performRefreshTokenRotation();
    _refreshInProgress = rotation;
    try {
      await rotation;
    } finally {
      if (identical(_refreshInProgress, rotation)) _refreshInProgress = null;
    }
  }

  Future<void> _performRefreshTokenRotation() async {
    final credentials = await _readRefreshCredentials();
    if (credentials == null) {
      await _clearSession();
      throw const ApiException(
        401,
        'INVALID_SESSION',
        'La sesión ya no está disponible. Inicia sesión nuevamente.',
      );
    }
    final response = await _http
        .post(
          _baseApiUrl.resolve('auth/refresh'),
          headers: _csrfHeaders(
            credentials.refreshToken,
            credentials.csrfToken,
          ),
        )
        .timeout(const Duration(seconds: 15));
    if (response.statusCode == 401 || response.statusCode == 403) {
      await _clearSession();
      throw const ApiException(
        401,
        'INVALID_SESSION',
        'La sesión ya no está disponible. Inicia sesión nuevamente.',
      );
    }
    final body = _decodeResponse(response);
    await _saveRotatedCookies(response);
    _session = _sessionFromJson(body);
  }

  Map<String, String> _baseHeaders() => {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Origin': _mobileOrigin,
  };

  Map<String, String> _csrfHeaders(String refreshToken, String csrfToken) => {
    ..._baseHeaders(),
    'Cookie': 'mvp_refresh=$refreshToken; mvp_csrf=$csrfToken',
    'X-CSRF-Token': csrfToken,
  };

  Future<void> _saveRotatedCookies(http.Response response) async {
    final cookies = response.headers['set-cookie'] ?? '';
    final refresh = RegExp(
      r'(?:^|[,;]\s*)mvp_refresh=([^;,\s]+)',
    ).firstMatch(cookies)?.group(1);
    final csrf = RegExp(
      r'(?:^|[,;]\s*)mvp_csrf=([^;,\s]+)',
    ).firstMatch(cookies)?.group(1);
    if (refresh == null || csrf == null) {
      await _clearSession();
      throw const ApiException(
        502,
        'SESSION_COOKIE_MISSING',
        'mvp-base no devolvió la sesión segura esperada.',
      );
    }
    await _storage.write(
      key: _refreshSessionKey,
      value: jsonEncode({'refreshToken': refresh, 'csrfToken': csrf}),
    );
  }

  DriverSession _sessionFromJson(Map<String, dynamic> body) {
    final token = body['accessToken'];
    final expiresAt = body['accessTokenExpiresAt'];
    final organizations = body['organizations'];
    final selectedOrganizationId = body['selectedOrganizationId'];
    final user = body['user'];
    if (token is! String ||
        expiresAt is! String ||
        organizations is! List ||
        user is! Map<String, dynamic>) {
      throw const ApiException(
        502,
        'BASE_INVALID_RESPONSE',
        'mvp-base devolvió una sesión no válida.',
      );
    }
    return DriverSession(
      accessToken: token,
      accessTokenExpiresAt: DateTime.parse(expiresAt),
      organizations: organizations
          .map(
            (item) => OrganizationOption.fromJson(
              Map<String, dynamic>.from(item as Map),
            ),
          )
          .toList(),
      selectedOrganizationId: selectedOrganizationId is String
          ? selectedOrganizationId
          : null,
      displayName: user['displayName'] is String
          ? user['displayName'] as String
          : '',
    );
  }

  Map<String, dynamic> _decodeResponse(http.Response response) {
    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = decoded is Map<String, dynamic> ? decoded['error'] : null;
      final record = error is Map<String, dynamic>
          ? error
          : <String, dynamic>{};
      throw ApiException(
        response.statusCode,
        record['code'] is String ? record['code'] as String : 'REQUEST_FAILED',
        record['message'] is String
            ? record['message'] as String
            : 'No se pudo completar la solicitud.',
      );
    }
    if (decoded is! Map<String, dynamic>)
      throw const ApiException(
        502,
        'INVALID_RESPONSE',
        'El servidor devolvió una respuesta no válida.',
      );
    return decoded;
  }

  DriverSession _requireSession() {
    final current = _session;
    if (current == null)
      throw const ApiException(
        401,
        'UNAUTHENTICATED',
        'Inicia sesión para continuar.',
      );
    return current;
  }

  Future<void> _clearSession() async {
    _session = null;
    await _storage.delete(key: _refreshSessionKey);
  }

  Future<Never> _invalidateSession() async {
    await _clearSession();
    throw const ApiException(
      401,
      'INVALID_SESSION',
      'La sesión ya no está disponible. Inicia sesión nuevamente.',
    );
  }

  Future<({String refreshToken, String csrfToken})?>
  _readRefreshCredentials() async {
    final value = await _storage.read(key: _refreshSessionKey);
    if (value == null) return null;
    try {
      final decoded = jsonDecode(value);
      if (decoded is Map<String, dynamic> &&
          decoded['refreshToken'] is String &&
          decoded['csrfToken'] is String) {
        return (
          refreshToken: decoded['refreshToken'] as String,
          csrfToken: decoded['csrfToken'] as String,
        );
      }
    } on FormatException {
      // Treat corrupt local credentials as an expired session.
    }
    await _clearSession();
    return null;
  }

  void dispose() => _http.close();
}

Uri _withTrailingSlash(Uri value) =>
    value.path.endsWith('/') ? value : value.replace(path: '${value.path}/');
