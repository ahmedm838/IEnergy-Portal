-- "Shortage hrs" reads "Shortage hours" everywhere the type's English
-- name is shown. The code stays shortage_hrs: records and the app use it.
update public.attendance_types set name_en = 'Shortage hours' where code = 'shortage_hrs';
