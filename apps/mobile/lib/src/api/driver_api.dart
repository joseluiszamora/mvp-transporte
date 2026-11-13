import 'package:mvp_transporte_mobile/src/api/base_auth_client.dart';
import 'package:mvp_transporte_mobile/src/api/driver_trip.dart';

class DriverApi {
  const DriverApi(this._auth);

  final BaseAuthClient _auth;

  Future<List<DriverTrip>> listTrips() async {
    final response = await _auth.transportGet(
      'driver/trips?limit=100&offset=0',
    );
    final items = response['items'];
    if (items is! List)
      throw const ApiException(
        502,
        'INVALID_RESPONSE',
        'La lista de viajes no es válida.',
      );
    return items
        .map(
          (item) => DriverTrip.fromJson(Map<String, dynamic>.from(item as Map)),
        )
        .toList();
  }

  Future<DriverTrip> getTrip(String tripId) async {
    final response = await _auth.transportGet('driver/trips/$tripId');
    final item = response['item'];
    if (item is! Map)
      throw const ApiException(
        502,
        'INVALID_RESPONSE',
        'El viaje no está disponible.',
      );
    return DriverTrip.fromJson(Map<String, dynamic>.from(item));
  }

  Future<DriverTrip> transition(String tripId, String status) async {
    final response = await _auth.transportPatch('driver/trips/$tripId/status', {
      'status': status,
    });
    final item = response['item'];
    if (item is! Map)
      throw const ApiException(
        502,
        'INVALID_RESPONSE',
        'No se pudo guardar el viaje.',
      );
    return DriverTrip.fromJson(Map<String, dynamic>.from(item));
  }
}
