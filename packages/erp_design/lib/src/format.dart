import 'catalog/generated.dart';

/// Formatting for the cell types and number formats in the catalog. Amounts
/// arrive in cents.
abstract final class Fmt {
  static const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  static String grouped(num value, {int decimals = 0}) {
    final negative = value < 0;
    final fixed = value.abs().toStringAsFixed(decimals);
    final parts = fixed.split('.');
    final digits = parts[0];
    final buf = StringBuffer();
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && (digits.length - i) % 3 == 0) buf.write(',');
      buf.write(digits[i]);
    }
    final out = parts.length > 1 ? '$buf.${parts[1]}' : buf.toString();
    return negative ? '-$out' : out;
  }

  static String money(num cents, {String symbol = r'$'}) {
    final s = grouped(cents / 100, decimals: 2);
    return s.startsWith('-') ? '-$symbol${s.substring(1)}' : '$symbol$s';
  }

  /// Short form for headline numbers, such as $1.14M.
  static String moneyCompact(num cents, {String symbol = r'$'}) {
    final v = cents / 100;
    final a = v.abs();
    final sign = v < 0 ? '-' : '';
    String trim(String s) => s.contains('.') ? s.replaceFirst(RegExp(r'\.?0+$'), '') : s;
    if (a == 0) return '${symbol}0';
    if (a >= 1e6) return '$sign$symbol${trim((a / 1e6).toStringAsFixed(2))}M';
    if (a >= 1e4) return '$sign$symbol${trim((a / 1e3).toStringAsFixed(1))}k';
    return money(cents, symbol: symbol);
  }

  static String percent(num value) => '${value.toStringAsFixed(1)}%';

  static String date(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    final u = d.toUtc();
    return '${u.day.toString().padLeft(2, '0')} ${_months[u.month - 1]} ${u.year}';
  }

  static String dateTime(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    final u = d.toUtc();
    return '${date(iso)}, ${u.hour.toString().padLeft(2, '0')}:${u.minute.toString().padLeft(2, '0')}';
  }

  static String status(String raw) => raw.replaceAll('_', ' ');

  static String format(Format format, num value, {bool compact = false}) => switch (format) {
        Format.money => compact ? moneyCompact(value) : money(value),
        Format.number => grouped(value),
        Format.percent => percent(value),
      };

  static String cell(CellType type, Object? value) {
    if (value == null) return '';
    return switch (type) {
      CellType.money => value is num ? money(value) : '$value',
      CellType.number => value is num ? grouped(value) : '$value',
      CellType.percent => value is num ? percent(value) : '$value',
      CellType.date => date('$value'),
      CellType.datetime => dateTime('$value'),
      CellType.status => status('$value'),
      CellType.text || CellType.mono => '$value',
    };
  }

  static bool isNumeric(CellType type) => type == CellType.money || type == CellType.number || type == CellType.percent;
}
