class DriverTrip {
  const DriverTrip({
    required this.id,
    required this.type,
    required this.status,
    required this.vehiclePlate,
    required this.origin,
    required this.destination,
    required this.stops,
    required this.sealNumbers,
    required this.plannedStartAt,
    required this.plannedEndAt,
    required this.actualStartAt,
    required this.actualEndAt,
    required this.driverAssignments,
  });

  final String id;
  final String type;
  final String status;
  final String vehiclePlate;
  final String origin;
  final String destination;
  final List<String> stops;
  final List<String> sealNumbers;
  final DateTime plannedStartAt;
  final DateTime plannedEndAt;
  final DateTime? actualStartAt;
  final DateTime? actualEndAt;
  final List<DriverAssignmentWindow> driverAssignments;

  factory DriverTrip.fromJson(Map<String, dynamic> value) => DriverTrip(
    id: value['id'] as String,
    type: value['type'] as String,
    status: value['status'] as String,
    vehiclePlate: value['vehiclePlate'] as String,
    origin: value['origin'] as String,
    destination: value['destination'] as String,
    stops: (value['stops'] as List).cast<String>(),
    sealNumbers: (value['sealNumbers'] as List).cast<String>(),
    plannedStartAt: DateTime.parse(value['plannedStartAt'] as String),
    plannedEndAt: DateTime.parse(value['plannedEndAt'] as String),
    actualStartAt: value['actualStartAt'] is String
        ? DateTime.parse(value['actualStartAt'] as String)
        : null,
    actualEndAt: value['actualEndAt'] is String
        ? DateTime.parse(value['actualEndAt'] as String)
        : null,
    driverAssignments: (value['driverAssignments'] as List)
        .map(
          (item) => DriverAssignmentWindow.fromJson(
            Map<String, dynamic>.from(item as Map),
          ),
        )
        .toList(),
  );
}

class DriverAssignmentWindow {
  const DriverAssignmentWindow({required this.startsAt, required this.endsAt});

  final DateTime startsAt;
  final DateTime endsAt;

  factory DriverAssignmentWindow.fromJson(Map<String, dynamic> value) =>
      DriverAssignmentWindow(
        startsAt: DateTime.parse(value['startsAt'] as String),
        endsAt: DateTime.parse(value['endsAt'] as String),
      );
}
