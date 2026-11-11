use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum ScalarType {
    I8 = 1,
    U8 = 2,
    I16 = 3,
    U16 = 4,
    I32 = 5,
    U32 = 6,
    I64 = 7,
    U64 = 8,
    F16 = 9,
    Bf16 = 10,
    F32 = 11,
    F64 = 12,
}

impl ScalarType {
    pub const fn tag(self) -> u8 {
        self as u8
    }

    pub const fn width(self) -> usize {
        match self {
            Self::I8 | Self::U8 => 1,
            Self::I16 | Self::U16 | Self::F16 | Self::Bf16 => 2,
            Self::I32 | Self::U32 | Self::F32 => 4,
            Self::I64 | Self::U64 | Self::F64 => 8,
        }
    }

    pub fn from_tag(tag: u8) -> Result<Self, PackedVectorError> {
        match tag {
            1 => Ok(Self::I8),
            2 => Ok(Self::U8),
            3 => Ok(Self::I16),
            4 => Ok(Self::U16),
            5 => Ok(Self::I32),
            6 => Ok(Self::U32),
            7 => Ok(Self::I64),
            8 => Ok(Self::U64),
            9 => Ok(Self::F16),
            10 => Ok(Self::Bf16),
            11 => Ok(Self::F32),
            12 => Ok(Self::F64),
            _ => Err(PackedVectorError::UnsupportedScalar(tag)),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct VectorSchema {
    pub dimensions: u32,
    pub scalar: ScalarType,
}

impl VectorSchema {
    pub fn new(dimensions: u32, scalar: ScalarType) -> Result<Self, PackedVectorError> {
        if dimensions == 0 {
            return Err(PackedVectorError::ZeroDimensions);
        }
        Ok(Self { dimensions, scalar })
    }

    pub fn row_bytes(self) -> Result<usize, PackedVectorError> {
        (self.dimensions as usize)
            .checked_mul(self.scalar.width())
            .ok_or(PackedVectorError::SizeOverflow)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackedVectors {
    schema: VectorSchema,
    count: usize,
    bytes: Vec<u8>,
}

impl PackedVectors {
    pub fn from_bytes(schema: VectorSchema, bytes: Vec<u8>) -> Result<Self, PackedVectorError> {
        let row_bytes = schema.row_bytes()?;
        if bytes.len() % row_bytes != 0 {
            return Err(PackedVectorError::PartialRow);
        }
        Ok(Self {
            schema,
            count: bytes.len() / row_bytes,
            bytes,
        })
    }

    pub fn from_rows(schema: VectorSchema, rows: &[&[u8]]) -> Result<Self, PackedVectorError> {
        let row_bytes = schema.row_bytes()?;
        let capacity = rows
            .len()
            .checked_mul(row_bytes)
            .ok_or(PackedVectorError::SizeOverflow)?;
        let mut bytes = Vec::with_capacity(capacity);
        for row in rows {
            if row.len() != row_bytes {
                return Err(PackedVectorError::WrongRowLength);
            }
            bytes.extend_from_slice(row);
        }
        Self::from_bytes(schema, bytes)
    }

    pub fn schema(&self) -> VectorSchema {
        self.schema
    }

    pub fn count(&self) -> usize {
        self.count
    }

    pub fn row(&self, index: usize) -> Option<&[u8]> {
        let row_bytes = self.schema.row_bytes().ok()?;
        let start = index.checked_mul(row_bytes)?;
        let end = start.checked_add(row_bytes)?;
        self.bytes.get(start..end)
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PackedVectorError {
    ZeroDimensions,
    SizeOverflow,
    PartialRow,
    WrongRowLength,
    UnsupportedScalar(u8),
}

impl fmt::Display for PackedVectorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "packed vector error: {self:?}")
    }
}

impl std::error::Error for PackedVectorError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_arbitrary_dimensions_and_scalar_widths() {
        let int8 = VectorSchema::new(512, ScalarType::I8).unwrap();
        let float64 = VectorSchema::new(4096, ScalarType::F64).unwrap();
        assert_eq!(int8.row_bytes().unwrap(), 512);
        assert_eq!(float64.row_bytes().unwrap(), 32_768);
    }

    #[test]
    fn stores_rows_contiguously_and_addresses_by_ordinal() {
        let schema = VectorSchema::new(3, ScalarType::I16).unwrap();
        let first = [1, 2, 3, 4, 5, 6];
        let second = [7, 8, 9, 10, 11, 12];
        let packed = PackedVectors::from_rows(schema, &[&first, &second]).unwrap();
        assert_eq!(packed.count(), 2);
        assert_eq!(packed.row(0), Some(first.as_slice()));
        assert_eq!(packed.row(1), Some(second.as_slice()));
        assert_eq!(packed.row(2), None);
    }

    #[test]
    fn rejects_partial_rows() {
        let schema = VectorSchema::new(3, ScalarType::F32).unwrap();
        assert_eq!(
            PackedVectors::from_bytes(schema, vec![0; 13]),
            Err(PackedVectorError::PartialRow)
        );
    }
}
