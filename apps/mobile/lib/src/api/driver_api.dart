import 'package:mvp_transporte_mobile/src/api/base_auth_client.dart';
import 'package:mvp_transporte_mobile/src/api/driver_trip.dart';

class DriverApi {
  const DriverApi(this._auth);

  final BaseAuthClient _auth;

  Future<DriverTripPage> listTrips({
    required int limit,
    required int offset,
  }) async {
    final response = await _auth.transportGet(
      'driver/trips?limit=$limit&offset=$offset',
    );
    final items = response['items'];
    final total = response['total'];
    final pageLimit = response['limit'];
    final pageOffset = response['offset'];
    if (items is! List ||
        total is! int ||
        pageLimit is! int ||
        pageOffset is! int ||
        total < 0 ||
        pageLimit != limit ||
        pageOffset != offset) {
      throw const ApiException(
        502,
        'INVALID_RESPONSE',
        'La lista de viajes no es válida.',
      );
    }
    final trips = items.map((item) {
      if (item is! Map) {
        throw const ApiException(
          502,
          'INVALID_RESPONSE',
          'La lista de viajes no es válida.',
        );
      }
      return DriverTrip.fromJson(Map<String, dynamic>.from(item));
    }).toList();
    return DriverTripPage(
      items: trips,
      total: total,
      limit: pageLimit,
      offset: pageOffset,
    );
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

class DriverTripPage {
  const DriverTripPage({
    required this.items,
    required this.total,
    required this.limit,
    required this.offset,
  });

  final List<DriverTrip> items;
  final int total;
  final int limit;
  final int offset;

  int get nextOffset => offset + items.length;

  bool get hasMore => items.isNotEmpty && nextOffset < total;
}
