import 'package:flutter/material.dart';
import 'package:mvp_transporte_mobile/src/api/base_auth_client.dart';
import 'package:mvp_transporte_mobile/src/api/driver_api.dart';
import 'package:mvp_transporte_mobile/src/api/driver_trip.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DriverApp());
}

class DriverApp extends StatefulWidget {
  const DriverApp({super.key});

  @override
  State<DriverApp> createState() => _DriverAppState();
}

class _DriverAppState extends State<DriverApp> {
  late final BaseAuthClient _auth;
  DriverSession? _session;
  bool _loading = true;
  String? _startupError;

  @override
  void initState() {
    super.initState();
    _auth = BaseAuthClient();
    _restore();
  }

  Future<void> _restore() async {
    try {
      final restored = await _auth.restoreSession();
      if (restored != null) _session = await _resolveOrganization(restored);
    } catch (error) {
      _startupError = error.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<DriverSession> _resolveOrganization(DriverSession session) async {
    if (session.selectedOrganizationId == null &&
        session.organizations.length == 1) {
      return _auth.selectOrganization(session.organizations.single.id);
    }
    return session;
  }

  Future<void> _onLogin(DriverSession session) async {
    final resolved = await _resolveOrganization(session);
    if (mounted) setState(() => _session = resolved);
  }

  Future<void> _onSelectOrganization(String organizationId) async {
    try {
      final session = await _auth.selectOrganization(organizationId);
      if (mounted) setState(() => _session = session);
    } catch (error) {
      if (_isSessionExpired(error)) {
        _onSessionExpired();
      } else if (mounted) {
        setState(() => _startupError = error.toString());
      }
    }
  }

  void _onSessionExpired() {
    if (!mounted) return;
    setState(() {
      _session = null;
      _startupError = 'La sesión expiró. Inicia sesión nuevamente.';
    });
  }

  Future<void> _onLogout() async {
    String? error;
    try {
      await _auth.logout();
    } catch (logoutError) {
      error =
          'La sesión se quitó del dispositivo, pero no se pudo confirmar su cierre en mvp-base: $logoutError';
    }
    if (mounted)
      setState(() {
        _session = null;
        _startupError = error;
      });
  }

  String get _rootPageKey {
    if (_loading) return 'loading';
    final current = _session;
    if (current == null) return 'login';
    final organizationId = current.selectedOrganizationId;
    return organizationId == null ? 'organization' : 'driver:$organizationId';
  }

  @override
  void dispose() {
    _auth.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      key: ValueKey(_rootPageKey),
      title: 'mvp-transporte · Conductor',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff1565c0)),
        useMaterial3: true,
      ),
      home: _loading
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : _session == null
          ? LoginScreen(
              auth: _auth,
              onLogin: _onLogin,
              initialError: _startupError,
            )
          : _session!.selectedOrganizationId == null
          ? OrganizationScreen(
              session: _session!,
              onSelect: _onSelectOrganization,
              error: _startupError,
            )
          : DriverHomeScreen(
              session: _session!,
              api: DriverApi(_auth),
              onLogout: _onLogout,
              onSessionExpired: _onSessionExpired,
            ),
    );
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    required this.auth,
    required this.onLogin,
    this.initialError,
    super.key,
  });

  final BaseAuthClient auth;
  final Future<void> Function(DriverSession) onLogin;
  final String? initialError;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _busy = false;
  bool _obscurePassword = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _error = widget.initialError;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onLogin(
        await widget.auth.login(
          _emailController.text,
          _passwordController.text,
        ),
      );
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.local_shipping_outlined, size: 52),
                  const SizedBox(height: 12),
                  Text(
                    'Acceso de conductor',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 28),
                  TextFormField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.username],
                    decoration: const InputDecoration(
                      labelText: 'Correo',
                      border: OutlineInputBorder(),
                    ),
                    validator: (value) => value == null || !value.contains('@')
                        ? 'Ingresa un correo válido.'
                        : null,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _passwordController,
                    obscureText: _obscurePassword,
                    autofillHints: const [AutofillHints.password],
                    decoration: InputDecoration(
                      labelText: 'Contraseña',
                      border: const OutlineInputBorder(),
                      suffixIcon: IconButton(
                        onPressed: () => setState(
                          () => _obscurePassword = !_obscurePassword,
                        ),
                        icon: Icon(
                          _obscurePassword
                              ? Icons.visibility_outlined
                              : Icons.visibility_off_outlined,
                        ),
                      ),
                    ),
                    validator: (value) => value == null || value.isEmpty
                        ? 'Ingresa tu contraseña.'
                        : null,
                    onFieldSubmitted: (_) => _submit(),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 14),
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Iniciar sesión'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class OrganizationScreen extends StatefulWidget {
  const OrganizationScreen({
    required this.session,
    required this.onSelect,
    this.error,
    super.key,
  });

  final DriverSession session;
  final Future<void> Function(String) onSelect;
  final String? error;

  @override
  State<OrganizationScreen> createState() => _OrganizationScreenState();
}

class _OrganizationScreenState extends State<OrganizationScreen> {
  String? _selectedId;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _selectedId = widget.session.organizations.isEmpty
        ? null
        : widget.session.organizations.first.id;
  }

  Future<void> _continue() async {
    final organizationId = _selectedId;
    if (organizationId == null || _busy) return;

    setState(() => _busy = true);
    try {
      await widget.onSelect(organizationId);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Seleccionar empresa de trabajo')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Hola ${widget.session.displayName}. Selecciona una organización para continuar.',
            ),
            const SizedBox(height: 16),
            if (widget.session.organizations.isEmpty)
              const Text(
                'Tu usuario no tiene una organización activa. Contacta al administrador.',
              ),
            if (widget.session.organizations.isNotEmpty)
              DropdownButtonFormField<String>(
                initialValue: _selectedId,
                items: widget.session.organizations
                    .map(
                      (item) => DropdownMenuItem(
                        value: item.id,
                        child: Text(item.name),
                      ),
                    )
                    .toList(),
                onChanged: _busy
                    ? null
                    : (value) => setState(() => _selectedId = value),
                decoration: const InputDecoration(
                  labelText: 'Organización',
                  border: OutlineInputBorder(),
                ),
              ),
            if (widget.error != null) ...[
              const SizedBox(height: 12),
              Text(
                widget.error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 18),
            FilledButton(
              onPressed: _selectedId == null || _busy ? null : _continue,
              child: _busy
                  ? const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        SizedBox(width: 12),
                        Text('Continuando...'),
                      ],
                    )
                  : const Text('Continuar'),
            ),
          ],
        ),
      ),
    );
  }
}

class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({
    required this.session,
    required this.api,
    required this.onLogout,
    required this.onSessionExpired,
    super.key,
  });

  final DriverSession session;
  final DriverApi api;
  final Future<void> Function() onLogout;
  final VoidCallback onSessionExpired;

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends State<DriverHomeScreen> {
  static const _tripPageSize = 20;

  List<DriverTrip> _trips = [];
  int _nextOffset = 0;
  bool _hasMore = false;
  bool _loadingMore = false;
  bool _loading = true;
  String? _error;
  String? _loadMoreError;
  int _tripQueryGeneration = 0;

  @override
  void initState() {
    super.initState();
    _loadTrips();
  }

  Future<void> _loadTrips() async {
    final generation = ++_tripQueryGeneration;
    setState(() {
      _loading = true;
      _loadingMore = false;
      _error = null;
      _loadMoreError = null;
      _trips = [];
      _nextOffset = 0;
      _hasMore = false;
    });
    try {
      final page = await widget.api.listTrips(limit: _tripPageSize, offset: 0);
      if (mounted && generation == _tripQueryGeneration) {
        setState(() {
          _trips = page.items;
          _nextOffset = page.nextOffset;
          _hasMore = page.hasMore;
        });
      }
    } catch (error) {
      if (!mounted || generation != _tripQueryGeneration) return;
      if (_isSessionExpired(error)) {
        widget.onSessionExpired();
      } else {
        _error = error.toString();
      }
    } finally {
      if (mounted && generation == _tripQueryGeneration) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _loadMoreTrips() async {
    if (_loading || _loadingMore || !_hasMore) return;
    final generation = _tripQueryGeneration;
    setState(() {
      _loadingMore = true;
      _loadMoreError = null;
    });
    try {
      final page = await widget.api.listTrips(
        limit: _tripPageSize,
        offset: _nextOffset,
      );
      if (mounted && generation == _tripQueryGeneration) {
        final knownIds = _trips.map((trip) => trip.id).toSet();
        setState(() {
          _trips = [
            ..._trips,
            ...page.items.where((trip) => knownIds.add(trip.id)),
          ];
          _nextOffset = page.nextOffset;
          _hasMore = page.hasMore;
        });
      }
    } catch (error) {
      if (!mounted || generation != _tripQueryGeneration) return;
      if (_isSessionExpired(error)) {
        widget.onSessionExpired();
      } else if (mounted) {
        setState(() => _loadMoreError = error.toString());
      }
    } finally {
      if (mounted && generation == _tripQueryGeneration) {
        setState(() => _loadingMore = false);
      }
    }
  }

  Future<void> _openTrip(DriverTrip trip) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => DriverTripDetailScreen(
          api: widget.api,
          initialTrip: trip,
          onSessionExpired: widget.onSessionExpired,
        ),
      ),
    );
    if (mounted) await _loadTrips();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mis viajes'),
        actions: [
          IconButton(
            tooltip: 'Cerrar sesión',
            onPressed: widget.onLogout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadTrips,
        child: _loading
            ? ListView(
                children: [
                  SizedBox(
                    height: 260,
                    child: Center(child: CircularProgressIndicator()),
                  ),
                ],
              )
            : _error != null
            ? ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  Text(_error!),
                  TextButton(
                    onPressed: _loadTrips,
                    child: const Text('Reintentar'),
                  ),
                ],
              )
            : _trips.isEmpty
            ? ListView(
                children: const [
                  SizedBox(
                    height: 260,
                    child: Center(child: Text('No tienes viajes asignados.')),
                  ),
                ],
              )
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount:
                    _trips.length +
                    (_hasMore || _loadMoreError != null ? 1 : 0),
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  if (index < _trips.length) {
                    final trip = _trips[index];
                    return _TripCard(trip: trip, onTap: () => _openTrip(trip));
                  }
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Column(
                      children: [
                        if (_loadMoreError != null)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Text(
                              _loadMoreError!,
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.error,
                              ),
                            ),
                          ),
                        if (_loadingMore)
                          const CircularProgressIndicator()
                        else
                          OutlinedButton.icon(
                            onPressed: _loadMoreTrips,
                            icon: const Icon(Icons.expand_more),
                            label: Text(
                              _loadMoreError == null
                                  ? 'Cargar más viajes'
                                  : 'Reintentar',
                            ),
                          ),
                      ],
                    ),
                  );
                },
              ),
      ),
    );
  }
}

class _TripCard extends StatelessWidget {
  const _TripCard({required this.trip, required this.onTap});

  final DriverTrip trip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        onTap: onTap,
        leading: const CircleAvatar(child: Icon(Icons.route_outlined)),
        title: Text(
          '${trip.origin} → ${trip.destination}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          '${_statusLabel(trip.status)} · ${trip.vehiclePlate}\n${_dateLabel(trip.plannedStartAt)}',
        ),
        isThreeLine: true,
        trailing: const Icon(Icons.chevron_right),
      ),
    );
  }
}

class DriverTripDetailScreen extends StatefulWidget {
  const DriverTripDetailScreen({
    required this.api,
    required this.initialTrip,
    required this.onSessionExpired,
    super.key,
  });

  final DriverApi api;
  final DriverTrip initialTrip;
  final VoidCallback onSessionExpired;

  @override
  State<DriverTripDetailScreen> createState() => _DriverTripDetailScreenState();
}

class _DriverTripDetailScreenState extends State<DriverTripDetailScreen> {
  late DriverTrip _trip = widget.initialTrip;
  bool _loading = false;
  String? _error;

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _trip = await widget.api.getTrip(_trip.id);
    } catch (error) {
      if (_isSessionExpired(error)) {
        widget.onSessionExpired();
      } else {
        _error = error.toString();
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _transition(String status) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _trip = await widget.api.transition(_trip.id, status);
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('El cambio se guardó correctamente.')),
        );
    } catch (error) {
      if (_isSessionExpired(error)) {
        widget.onSessionExpired();
      } else {
        _error = error.toString();
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final action = _trip.status == 'ASSIGNED'
        ? ('IN_PROGRESS', 'Iniciar viaje')
        : _trip.status == 'IN_PROGRESS'
        ? ('COMPLETED', 'Completar viaje')
        : null;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Detalle del viaje'),
        actions: [
          IconButton(
            onPressed: _loading ? null : _refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            '${_trip.origin} → ${_trip.destination}',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Chip(label: Text(_statusLabel(_trip.status))),
          _DetailRow(label: 'Vehículo', value: _trip.vehiclePlate),
          _DetailRow(
            label: 'Salida prevista',
            value: _dateLabel(_trip.plannedStartAt),
          ),
          _DetailRow(
            label: 'Llegada prevista',
            value: _dateLabel(_trip.plannedEndAt),
          ),
          if (_trip.actualStartAt != null)
            _DetailRow(
              label: 'Inicio real',
              value: _dateLabel(_trip.actualStartAt!),
            ),
          if (_trip.actualEndAt != null)
            _DetailRow(
              label: 'Fin real',
              value: _dateLabel(_trip.actualEndAt!),
            ),
          if (_trip.stops.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text('Paradas', style: Theme.of(context).textTheme.titleMedium),
            ..._trip.stops.map(
              (stop) => ListTile(
                dense: true,
                leading: const Icon(Icons.place_outlined),
                title: Text(stop),
              ),
            ),
          ],
          if (_trip.sealNumbers.isNotEmpty)
            _DetailRow(label: 'Precintos', value: _trip.sealNumbers.join(', ')),
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          if (action != null) ...[
            const SizedBox(height: 22),
            FilledButton.icon(
              onPressed: _loading ? null : () => _transition(action.$1),
              icon: _loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.check_circle_outline),
              label: Text(action.$2),
            ),
          ],
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => ListTile(
    contentPadding: EdgeInsets.zero,
    title: Text(label, style: Theme.of(context).textTheme.labelLarge),
    subtitle: Text(value),
  );
}

String _statusLabel(String value) => switch (value) {
  'PLANNED' => 'Planificado',
  'ASSIGNED' => 'Asignado',
  'IN_PROGRESS' => 'En curso',
  'COMPLETED' => 'Completado',
  'CANCELLED' => 'Cancelado',
  _ => value,
};

bool _isSessionExpired(Object error) =>
    error is ApiException && error.statusCode == 401;

String _dateLabel(DateTime value) {
  final local = value.toLocal();
  String two(int part) => part.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}
