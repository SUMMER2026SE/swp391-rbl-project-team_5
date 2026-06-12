async function refreshAttractionMinPrice(client, attractionId) {
  const result = await client.ticketProduct.aggregate({
    where: {
      attractionId,
      status: 'ACTIVE',
      archivedAt: null,
    },
    _min: { sellingPrice: true },
  });

  await client.attraction.update({
    where: { id: attractionId },
    data: { minTicketPrice: result?._min?.sellingPrice ?? null },
  });
}

module.exports = { refreshAttractionMinPrice };
