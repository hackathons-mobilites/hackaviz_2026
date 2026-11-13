"""Earliest-arrival Connection Scan Algorithm (one origin -> all stops), numba-compiled.

Connections must be sorted by departure time. Footpaths are applied one hop
after every improved vehicle arrival (GTFS transfers + short walks).
"""
import numpy as np
from numba import njit

INF = np.int32(2 ** 30)


class Network:
    def __init__(self, path):
        z = np.load(path, allow_pickle=False)
        self.stop_ids   = z["stop_ids"]
        self.stop_names = z["stop_names"]
        self.stop_x     = z["stop_x"]
        self.stop_y     = z["stop_y"]
        self.c_dep_stop = z["c_dep_stop"]
        self.c_arr_stop = z["c_arr_stop"]
        self.c_dep      = z["c_dep"]
        self.c_arr      = z["c_arr"]
        self.c_trip     = z["c_trip"]
        self.c_board    = z["c_board"]
        self.c_alight   = z["c_alight"]
        self.trip_rtype = z["trip_rtype"]
        self.n_stops    = len(self.stop_ids)
        self.n_trips    = len(self.trip_rtype)

        fp_from         = z["fp_from"]
        self.fp_to      = z["fp_to"]
        self.fp_dur     = z["fp_dur"]
        self.fp_ptr     = np.zeros(self.n_stops + 1, dtype=np.int64)
        np.add.at(self.fp_ptr, fp_from + 1, 1)
        self.fp_ptr     = np.cumsum(self.fp_ptr)

    def earliest_arrival(self, dep_time, src_stops, src_walk, max_t, slack):
        return _csa(np.int32(dep_time), src_stops.astype(np.int32), src_walk.astype(np.int32),
                    self.c_dep_stop, self.c_arr_stop, self.c_dep, self.c_arr, self.c_trip,
                    self.c_board, self.c_alight, self.fp_ptr, self.fp_to, self.fp_dur,
                    self.n_stops, self.n_trips, np.int32(max_t), np.int32(slack))


@njit(cache=True)
def _csa(dep_time, src_stops, src_walk,
         c_dep_stop, c_arr_stop, c_dep, c_arr, c_trip, c_board, c_alight,
         fp_ptr, fp_to, fp_dur, n_stops, n_trips, max_t, slack):
    arr     = np.full(n_stops, INF, dtype=np.int32)    # earliest arrival (for egress)
    board   = np.full(n_stops, INF, dtype=np.int32)    # earliest time a vehicle can be boarded
    trip_on = np.zeros(n_trips, dtype=np.bool_)

    for k in range(len(src_stops)):
        s = src_stops[k]
        t = dep_time + src_walk[k]
        if t < arr[s]:
            arr[s]   = t
            board[s] = t

    limit = dep_time + max_t
    i     = np.searchsorted(c_dep, dep_time)
    n     = len(c_dep)
    while i < n:
        d = c_dep[i]
        if d > limit:
            break
        tr = c_trip[i]
        if trip_on[tr] or (c_board[i] and board[c_dep_stop[i]] <= d):
            trip_on[tr] = True
            if c_alight[i]:
                s = c_arr_stop[i]
                a = c_arr[i]
                if a < arr[s]:
                    arr[s] = a
                    if a + slack < board[s]:
                        board[s] = a + slack
                    for k in range(fp_ptr[s], fp_ptr[s + 1]):
                        u  = fp_to[k]
                        t2 = a + fp_dur[k]
                        if t2 < arr[u]:
                            arr[u] = t2
                        if t2 < board[u]:
                            board[u] = t2
        i += 1
    return arr
