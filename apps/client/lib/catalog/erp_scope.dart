import 'package:flutter/widgets.dart';

/// Callbacks that generated surfaces need from the app around them.
class ErpScope extends InheritedWidget {
  const ErpScope({super.key, required this.ask, required this.openRow, required super.child});

  /// Sends a follow-up question as if the user typed it.
  final ValueChanged<String> ask;

  /// Opens a table row in the detail panel.
  final ValueChanged<Map<String, Object?>> openRow;

  static ErpScope of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<ErpScope>()!;

  @override
  bool updateShouldNotify(ErpScope old) => old.ask != ask || old.openRow != openRow;
}
